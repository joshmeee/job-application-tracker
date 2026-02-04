/**
 * Job Application Tracker - Google Apps Script
 *
 * Automatically detects job application confirmation emails from Gmail
 * and creates entries in a Notion database.
 *
 * Setup:
 * 1. Set your NOTION_TOKEN and NOTION_DATABASE_ID in Script Properties
 * 2. Run setupTrigger() once to enable hourly scanning
 */

// ============================================
// CONFIGURATION
// ============================================

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  // Check for temporary override (used by manualScan)
  const hoursToScan = props.getProperty('HOURS_TO_SCAN_TEMP') || '24';
  return {
    NOTION_TOKEN: props.getProperty('NOTION_TOKEN'),
    NOTION_DATABASE_ID: props.getProperty('NOTION_DATABASE_ID'),
    PROCESSED_LABEL: 'JobTracker/Processed',
    HOURS_TO_SCAN: parseInt(hoursToScan, 10) // How far back to look for emails
  };
}

// ============================================
// ATS DOMAIN LIST
// ============================================

const ATS_DOMAINS = [
  // Major ATS platforms
  'greenhouse-mail.io', 'greenhouse.io', 'boards.greenhouse.io',
  'hire.lever.co', 'lever.co',
  'myworkday.com', 'wd5.myworkday.com',
  'smartrecruiters.com', 'my.smartrecruiters.com',
  'icims.com',
  'jobvite.com',
  'bamboohr.com',
  'ashbyhq.com',
  'applytojob.com',  // JazzHR
  'recruiterbox.com',
  'taleo.net',
  'successfactors.com',
  'cornerstoneondemand.com',
  'breezy.hr',
  'recruitee.com',
  'personio.com',

  // Job boards
  'linkedin.com',
  'indeed.com', 'indeedmail.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'monster.com',
  'careerbuilder.com'
];

// Subject line keywords with confidence scores
const SUBJECT_KEYWORDS = {
  strong: [  // High confidence (5 points)
    'thank you for applying',
    'thanks for applying',
    'application received',
    'application submitted',
    'application confirmation',
    'we received your application',
    'your application has been submitted',
    'your application was sent'
  ],
  medium: [  // Medium confidence (3 points)
    'your application',
    'applied for',
    'application to',
    'application for'
  ],
  weak: [  // Low confidence alone (1 point)
    'application',
    'position',
    'opportunity'
  ]
};

// Body content signals for additional confidence
const BODY_SIGNALS = [
  'we have received your application',
  'your application has been received',
  'thank you for your interest in',
  'we will review your application',
  'application status',
  'candidate portal',
  'next steps in the hiring process',
  'our recruiting team',
  'talent acquisition',
  'hiring manager'
];

// ============================================
// EMAIL DETECTION PATTERNS
// ============================================

const EMAIL_PATTERNS = [
  // LinkedIn
  {
    source: 'LinkedIn',
    fromPatterns: ['jobs-noreply@linkedin.com', 'linkedin.com'],
    subjectPatterns: [
      /Your application was sent to (.+)/i,
      /You applied to (.+) at (.+)/i,
      /Your application to (.+) was sent/i,
      /Application sent: (.+) at (.+)/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      // Try subject patterns
      let match = subject.match(/Your application was sent to (.+)/i);
      if (match) {
        company = match[1].trim();
      }

      match = subject.match(/You applied to (.+) at (.+)/i);
      if (match) {
        position = match[1].trim();
        company = match[2].trim();
      }

      match = subject.match(/Application sent: (.+) at (.+)/i);
      if (match) {
        position = match[1].trim();
        company = match[2].trim();
      }

      // Try to extract from body if not found
      if (!position && body) {
        match = body.match(/applied for[:\s]+(.+?)(?:\n|at|$)/i);
        if (match) position = match[1].trim();
      }

      return { company, position };
    }
  },

  // Indeed
  {
    source: 'Indeed',
    fromPatterns: ['indeed.com', 'indeedmail.com'],
    subjectPatterns: [
      /Your application to (.+)/i,
      /Application submitted: (.+)/i,
      /You applied to (.+)/i,
      /Application to (.+) submitted/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      let match = subject.match(/Your application to (.+)/i);
      if (match) {
        company = match[1].trim();
      }

      match = subject.match(/Application submitted: (.+)/i);
      if (match) {
        position = match[1].trim();
      }

      // Indeed often has job title in body
      if (body) {
        match = body.match(/(?:applied for|position)[:\s]+(.+?)(?:\n|at|$)/i);
        if (match && !position) position = match[1].trim();

        match = body.match(/(?:at|company)[:\s]+(.+?)(?:\n|$)/i);
        if (match && !company) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // Glassdoor
  {
    source: 'Glassdoor',
    fromPatterns: ['glassdoor.com'],
    subjectPatterns: [
      /Application submitted for (.+)/i,
      /You applied for (.+)/i,
      /Thanks for applying to (.+)/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      let match = subject.match(/Application submitted for (.+)/i);
      if (match) {
        position = match[1].trim();
      }

      match = subject.match(/Thanks for applying to (.+)/i);
      if (match) {
        position = match[1].trim();
      }

      // Try body for company
      if (body) {
        match = body.match(/at\s+(.+?)(?:\.|,|\n|$)/i);
        if (match) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // Lever (common ATS)
  {
    source: 'Company Website',
    fromPatterns: ['lever.co', 'hire.lever.co'],
    subjectPatterns: [
      /Application received/i,
      /Thanks for applying/i,
      /We received your application/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      if (body) {
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        match = body.match(/(?:at|with)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // Greenhouse (common ATS)
  {
    source: 'Company Website',
    fromPatterns: ['greenhouse.io', 'boards.greenhouse.io', 'greenhouse-mail.io', 'us.greenhouse-mail.io'],
    subjectPatterns: [
      /Application received/i,
      /Thanks for applying/i,
      /Thank you for your application/i,
      /Thank you for applying/i,
      /We received your application/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      if (body) {
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        match = body.match(/(?:at|with)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // Workday (common ATS)
  {
    source: 'Company Website',
    fromPatterns: ['myworkday.com', 'workday.com', 'wd5.myworkday.com'],
    subjectPatterns: [
      /Application (?:received|submitted)/i,
      /Thank you for applying/i,
      /Thanks for applying/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      if (body) {
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        match = body.match(/(?:at|with)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // SmartRecruiters
  {
    source: 'Company Website',
    fromPatterns: ['smartrecruiters.com', 'my.smartrecruiters.com'],
    subjectPatterns: [
      /Application received/i,
      /Thank you for applying/i,
      /Thanks for applying/i,
      /We received your application/i,
      /Application confirmation/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      if (body) {
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        match = body.match(/(?:at|with|to)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();

        // SmartRecruiters often includes company name near "Team" or "Talent"
        if (!company) {
          match = body.match(/(.+?)\s+(?:Team|Talent|Recruiting|HR)/i);
          if (match) company = match[1].trim();
        }
      }

      return { company, position };
    }
  },

  // iCIMS
  {
    source: 'Company Website',
    fromPatterns: ['icims.com'],
    subjectPatterns: [
      /Application received/i,
      /Thank you for applying/i,
      /Thanks for applying/i,
      /Your application/i,
      /Application confirmation/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      if (body) {
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        match = body.match(/(?:at|with|to)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // Ashby
  {
    source: 'Company Website',
    fromPatterns: ['ashbyhq.com'],
    subjectPatterns: [
      /Application received/i,
      /Thank you for applying/i,
      /Thanks for applying/i,
      /We received your application/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      if (body) {
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        match = body.match(/(?:at|with|to)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // Jobvite
  {
    source: 'Company Website',
    fromPatterns: ['jobvite.com'],
    subjectPatterns: [
      /Application received/i,
      /Thank you for applying/i,
      /Thanks for applying/i,
      /Your application/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      if (body) {
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        match = body.match(/(?:at|with|to)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // ZipRecruiter
  {
    source: 'ZipRecruiter',
    fromPatterns: ['ziprecruiter.com'],
    subjectPatterns: [
      /Your application/i,
      /Application sent/i,
      /You applied to/i,
      /Application submitted/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      // Try to extract from subject
      let match = subject.match(/(?:Your application|You applied) (?:to|for) (.+)/i);
      if (match) {
        company = match[1].trim();
      }

      if (body) {
        match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match && !position) position = match[1].trim();

        match = body.match(/(?:at|with)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match && !company) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // BambooHR
  {
    source: 'Company Website',
    fromPatterns: ['bamboohr.com'],
    subjectPatterns: [
      /Application received/i,
      /Thank you for applying/i,
      /Thanks for applying/i,
      /Your application/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      if (body) {
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        match = body.match(/(?:at|with|to)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // JazzHR (applytojob.com)
  {
    source: 'Company Website',
    fromPatterns: ['applytojob.com'],
    subjectPatterns: [
      /Application received/i,
      /Thank you for applying/i,
      /Thanks for applying/i,
      /Your application/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      if (body) {
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        match = body.match(/(?:at|with|to)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // Taleo
  {
    source: 'Company Website',
    fromPatterns: ['taleo.net'],
    subjectPatterns: [
      /Application received/i,
      /Thank you for applying/i,
      /Your application/i,
      /Application confirmation/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      if (body) {
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        match = body.match(/(?:at|with|to)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();
      }

      return { company, position };
    }
  },

  // Generic "Thank you/Thanks for applying to [Company]" patterns
  {
    source: 'Company Website',
    fromPatterns: [], // Match any sender
    subjectPatterns: [
      /Thank you for applying to (.+)/i,
      /Thanks for applying to (.+)/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      // Extract company from subject - "Thank you for applying to [Company]"
      let match = subject.match(/Thank you for applying to (.+?)(?:!|$)/i);
      if (match) {
        company = match[1].trim();
      }

      // Try alternate pattern - "Thanks for applying to [Company]"
      if (!company) {
        match = subject.match(/Thanks for applying to (.+?)(?:!|$)/i);
        if (match) {
          company = match[1].trim();
        }
      }

      // Try to extract position from body
      if (body) {
        match = body.match(/(?:position|role|job)[:\s]+(.+?)(?:\n|\.|,|$)/i);
        if (match) position = match[1].trim();

        // Also try "applied for [Position]"
        if (!position) {
          match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
          if (match) position = match[1].trim();
        }
      }

      return { company, position };
    }
  },

  // Pattern for "Position - Company" format (like "SR. Data Analytics Manager - Adoreal")
  {
    source: 'Company Website',
    fromPatterns: [], // Match any sender
    subjectPatterns: [
      /^.+\s+-\s+.+$/  // Matches "Something - Something" format
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      // Extract from "Position - Company" format
      let match = subject.match(/^(.+?)\s+-\s+(.+?)$/);
      if (match) {
        position = match[1].trim();
        company = match[2].trim();
      }

      return { company, position };
    }
  },

  // Generic catch-all patterns
  {
    source: 'Other',
    fromPatterns: [], // Match any sender
    subjectPatterns: [
      /Thank you for applying/i,
      /Application received/i,
      /Application confirmation/i,
      /We received your application/i,
      /Thanks for your interest/i,
      /We.ve received your application/i,
      /Your application has been/i
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      // First try to extract from subject
      let match = subject.match(/(?:to|at|for)\s+(.+?)(?:!|\.|$)/i);
      if (match) {
        company = match[1].trim();
      }

      // Try to extract from body
      if (body) {
        if (!position) {
          match = body.match(/(?:position|role|job)[:\s]+(.+?)(?:\n|\.|,|$)/i);
          if (match) position = match[1].trim();
        }

        if (!position) {
          match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
          if (match) position = match[1].trim();
        }

        if (!company) {
          match = body.match(/(?:at|with|to)\s+(.+?)(?:\.|,|\n|!)/i);
          if (match) company = match[1].trim();
        }
      }

      return { company, position };
    }
  },

  // Fallback: Catch-all for known ATS domains with any job-related subject
  {
    source: 'Company Website',
    fromPatterns: ATS_DOMAINS,
    subjectPatterns: [
      /.*/  // Match any subject from ATS domain (subject filtering handled by scorer)
    ],
    extractInfo: function(subject, body) {
      let company = null;
      let position = null;

      // Try common extraction patterns from body
      if (body) {
        // Look for "applied for [Position]" or "applied to [Position]"
        let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.|,|\n)/i);
        if (match) position = match[1].trim();

        // Look for "at [Company]" or "with [Company]"
        match = body.match(/(?:at|with|to)\s+(.+?)(?:\.|,|\n|!)/i);
        if (match) company = match[1].trim();

        // Look for company name near recruiting/team keywords
        if (!company) {
          match = body.match(/(.+?)\s+(?:Team|Talent|Recruiting|HR|Careers)/i);
          if (match) company = match[1].trim();
        }

        // Try to find position from "position:" or "role:" labels
        if (!position) {
          match = body.match(/(?:position|role|job title)[:\s]+(.+?)(?:\n|\.|,|$)/i);
          if (match) position = match[1].trim();
        }
      }

      // Try to extract from subject if still missing
      if (!company) {
        let match = subject.match(/(?:at|from|to)\s+(.+?)(?:!|\.|$)/i);
        if (match) company = match[1].trim();
      }

      if (!position) {
        // Check for "Position - Company" format
        let match = subject.match(/^(.+?)\s+-\s+(.+?)$/);
        if (match) {
          position = match[1].trim();
          if (!company) company = match[2].trim();
        }
      }

      return { company, position };
    }
  }
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate subject line keyword score
 */
function calculateSubjectScore(subject) {
  const lowerSubject = subject.toLowerCase();
  let score = 0;

  // Check strong keywords (5 points each)
  for (const keyword of SUBJECT_KEYWORDS.strong) {
    if (lowerSubject.includes(keyword)) {
      score += 5;
    }
  }

  // Check medium keywords (3 points each)
  for (const keyword of SUBJECT_KEYWORDS.medium) {
    if (lowerSubject.includes(keyword)) {
      score += 3;
    }
  }

  // Check weak keywords (1 point each)
  for (const keyword of SUBJECT_KEYWORDS.weak) {
    if (lowerSubject.includes(keyword)) {
      score += 1;
    }
  }

  return score;
}

/**
 * Check if email body contains hiring-related signals
 */
function hasHiringBodySignals(body) {
  if (!body) return false;

  const lowerBody = body.toLowerCase();

  for (const signal of BODY_SIGNALS) {
    if (lowerBody.includes(signal)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if sender domain is a known ATS
 */
function isATSDomain(from) {
  const lowerFrom = from.toLowerCase();

  for (const domain of ATS_DOMAINS) {
    if (lowerFrom.includes(domain)) {
      return true;
    }
  }

  return false;
}

/**
 * Enhanced email detection using scoring system
 * Returns true if email is likely a job application confirmation
 */
function isJobApplicationEmail(from, subject, body) {
  const subjectLower = subject.toLowerCase();
  const fromLower = from.toLowerCase();

  // VERY STRICT: Must have these confirmation words
  const mustHaveWords = ['application', 'applying', 'applied'];
  const hasRequiredWord = mustHaveWords.some(word => subjectLower.includes(word));

  if (!hasRequiredWord) {
    return false;  // Immediately reject if no application-related word
  }

  // EXCLUDE bad patterns - check AFTER we know it has application words
  if (subjectLower.includes('job alert') ||
      subjectLower.includes('appeared in') ||
      subjectLower.includes('set up your') ||
      subjectLower.includes('jumpstart') ||
      subjectLower.includes('welcome!') ||
      subjectLower.includes('newsletter') ||
      subjectLower.includes('digest') ||
      subjectLower.includes('recommended') ||
      subjectLower.includes('new jobs') ||
      subjectLower.includes('jobs you might') ||
      subjectLower.includes('profile') ||
      subjectLower.includes('developer') ||
      subjectLower.includes('dashboard') ||
      subjectLower.includes('page for') ||
      subjectLower.includes('thank you for sharing') ||
      subjectLower.includes('crm:') ||
      subjectLower.includes('tron') ||
      subjectLower.includes('pac man')) {
    return false;
  }

  // Exclude LinkedIn non-job emails
  if (fromLower.includes('linkedin') && !fromLower.includes('jobs-noreply')) {
    return false;
  }

  // Exclude Indeed non-application emails
  if (fromLower.includes('indeed') && !fromLower.includes('indeedapply')) {
    if (subjectLower.includes('alert') || subjectLower.includes('sharing')) {
      return false;
    }
  }

  // Only accept if from known ATS or has strong confirmation phrase
  const isFromATS =
    fromLower.includes('indeedapply') ||
    fromLower.includes('jobvite') ||
    fromLower.includes('greenhouse') ||
    fromLower.includes('lever.co') ||
    fromLower.includes('workday') ||
    fromLower.includes('smartrecruiters') ||
    fromLower.includes('workable') ||
    fromLower.includes('ziprecruiter');

  const hasStrongConfirmation =
    subjectLower.includes('application received') ||
    subjectLower.includes('application submitted') ||
    subjectLower.includes('application is complete') ||
    subjectLower.includes('thanks for applying') ||
    subjectLower.includes('thank you for applying') ||
    subjectLower.includes('we received your application') ||
    subjectLower.includes('your application to') ||
    subjectLower.includes('your application for') ||
    subjectLower.includes('wants your application');

  return isFromATS || hasStrongConfirmation;
}

// ============================================
// MAIN FUNCTIONS
// ============================================

/**
 * Main function - scans Gmail and creates Notion entries
 * Run this manually or via trigger
 */
function scanEmailsAndCreateEntries() {
  const config = getConfig();

  if (!config.NOTION_TOKEN || !config.NOTION_DATABASE_ID) {
    Logger.log('ERROR: Please set NOTION_TOKEN and NOTION_DATABASE_ID in Script Properties');
    return;
  }

  // Get or create the processed label
  let processedLabel = GmailApp.getUserLabelByName(config.PROCESSED_LABEL);
  if (!processedLabel) {
    processedLabel = GmailApp.createLabel(config.PROCESSED_LABEL);
  }

  // Calculate time range
  const now = new Date();
  const hoursAgo = new Date(now.getTime() - (config.HOURS_TO_SCAN * 60 * 60 * 1000));
  const searchDate = Utilities.formatDate(hoursAgo, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  // Search for potential job application emails
  // Improved search query with more keywords and ATS domains
  const searchQuery = `after:${searchDate} -label:${config.PROCESSED_LABEL} (` +
    `subject:"application" OR subject:"applied" OR ` +
    `subject:"thank you for applying" OR subject:"thanks for applying" OR ` +
    `subject:"we received your" OR subject:"application confirmation" OR ` +
    `subject:"application submitted" OR subject:"application received" OR ` +
    `from:greenhouse OR from:lever.co OR from:workday OR ` +
    `from:smartrecruiters OR from:icims OR from:ashby OR ` +
    `from:jobvite OR from:bamboohr OR from:ziprecruiter OR ` +
    `from:indeed OR from:linkedin OR from:glassdoor OR from:taleo)`;

  Logger.log(`Searching with query: ${searchQuery}`);

  const threads = GmailApp.search(searchQuery, 0, 50);
  Logger.log(`Found ${threads.length} potential threads`);

  let entriesCreated = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();

    for (const message of messages) {
      const subject = message.getSubject();
      const from = message.getFrom();

      Logger.log(`\nProcessing: "${subject}"`);
      Logger.log(`  From: ${from}`);

      const result = processEmail(message, config);

      if (result.matched) {
        Logger.log(`  ✓ MATCHED - Company: ${result.company}, Position: ${result.position}, Source: ${result.source}`);

        // Create Notion entry
        const created = createNotionEntry(result, config);

        if (created) {
          entriesCreated++;
          // Label as processed
          thread.addLabel(processedLabel);
        }
      }
    }
  }

  Logger.log(`Created ${entriesCreated} new entries in Notion`);
}

/**
 * Process a single email and extract job application info
 */
function processEmail(message, config) {
  const from = message.getFrom().toLowerCase();
  const subject = message.getSubject();
  const body = message.getPlainBody();
  const date = message.getDate();

  // First, try pattern-based matching (existing logic)
  for (const pattern of EMAIL_PATTERNS) {
    // Check if sender matches (or pattern has no from filter)
    const fromMatches = pattern.fromPatterns.length === 0 ||
                        pattern.fromPatterns.some(p => from.includes(p.toLowerCase()));

    if (!fromMatches) continue;

    // Check if subject matches
    const subjectMatches = pattern.subjectPatterns.some(p => p.test(subject));

    if (!subjectMatches) continue;

    // Extract info
    const info = pattern.extractInfo(subject, body);

    // Only return if we got at least a company or position
    if (info.company || info.position) {
      return {
        matched: true,
        company: info.company || 'Unknown Company',
        position: info.position || 'Unknown Position',
        source: pattern.source,
        applicationDate: date,
        emailSubject: subject,
        emailFrom: from
      };
    }
  }

  // Fallback: Use scoring system for emails that didn't match patterns
  // This catches edge cases from ATS domains with unusual subject lines
  if (isJobApplicationEmail(from, subject, body)) {
    Logger.log(`  → Fallback scoring matched`);

    // Try to extract info using generic patterns
    let company = null;
    let position = null;

    // Extract from body with multiple patterns
    if (body) {
      // Position patterns
      let match = body.match(/applied (?:for|to)(?: the)?\s+(.+?)(?:\s+(?:position|role|at)|\.+|,|\n)/i);
      if (match) position = match[1].trim();

      if (!position) {
        match = body.match(/(?:position|role|job)[:\s]+(.+?)(?:\n|at|$)/i);
        if (match) position = match[1].trim();
      }

      // Company patterns
      match = body.match(/(?:at|with|for|to)\s+([A-Z][A-Za-z0-9\s&,\.]+?)(?:\.|,|\n|!|for|in)/i);
      if (match && match[1].length > 2 && match[1].length < 100) {
        company = match[1].trim();
      }

      if (!company) {
        match = body.match(/(?:company|employer)[:\s]+(.+?)(?:\n|$)/i);
        if (match) company = match[1].trim();
      }
    }

    // Extract from subject with more patterns
    if (!company) {
      let match = subject.match(/(?:at|from|to|with)\s+([A-Z][A-Za-z0-9\s&,\.]+?)(?:!|\.|$|-|for)/i);
      if (match && match[1].length > 2 && match[1].length < 60) {
        company = match[1].trim();
      }
    }

    // Check for "Position - Company" format
    if (!position || !company) {
      let match = subject.match(/^(.+?)\s+-\s+(.+?)$/);
      if (match) {
        if (!position) position = match[1].trim();
        if (!company) company = match[2].trim();
      }
    }

    // Try to extract company from email domain as last resort
    if (!company) {
      const domainMatch = from.match(/@([^@.]+)\./);
      if (domainMatch) {
        const domain = domainMatch[1];
        // Only use if it's not a generic email provider or ATS
        if (!['gmail', 'yahoo', 'outlook', 'hotmail', 'greenhouse', 'lever', 'workday'].includes(domain.toLowerCase())) {
          company = domain.charAt(0).toUpperCase() + domain.slice(1);
        }
      }
    }

    // Extract job URL from body
    let jobUrl = null;
    if (body) {
      // Look for common job board URLs
      const urlMatch = body.match(/https?:\/\/(www\.)?(linkedin\.com\/jobs\/view|indeed\.com\/viewjob|glassdoor\.com\/job-listing|greenhouse\.io\/[^\/]+\/jobs|boards\.greenhouse\.io\/[^\/]+\/jobs|jobs\.lever\.co|[^\s]+\.myworkday\.com\/[^\s]+|apply\.workable\.com)[^\s\)"']*/i);
      if (urlMatch) {
        jobUrl = urlMatch[0];
      }
    }

    // Extract location from body
    let location = null;
    if (body) {
      // Look for location patterns
      let match = body.match(/location[:\s]+([A-Za-z\s,]+?)(?:\n|$|remote|hybrid)/i);
      if (match) location = match[1].trim();

      if (!location) {
        match = body.match(/(Remote|Hybrid|On-site|Onsite)(?:\s*[-,]\s*([A-Za-z\s,]+))?/i);
        if (match) location = match[0].trim();
      }
    }

    // Accept if we have ANYTHING - even if extraction failed
    // Better to have entries to review than to miss applications
    Logger.log(`  → Extracted: Company="${company || 'Unknown'}", Position="${position || 'Unknown'}"`);
    if (jobUrl) Logger.log(`  → Job URL: ${jobUrl}`);
    if (location) Logger.log(`  → Location: ${location}`);

    return {
      matched: true,
      company: company || 'Unknown Company',
      position: position || 'Unknown Position',
      source: isATSDomain(from) ? 'Company Website' : 'Other',
      applicationDate: date,
      emailSubject: subject,
      emailFrom: from,
      jobUrl: jobUrl,
      location: location
    };
  }

  Logger.log(`  ✗ Not matched - failed scoring system`);
  return { matched: false };
}

// ============================================
// NOTION API FUNCTIONS
// ============================================

/**
 * Create a new entry in the Notion database
 * Or update existing entry if found
 */
function createNotionEntry(data, config) {
  // First, check if entry already exists for this company
  const existingEntry = findExistingEntry(data.company, config);

  if (existingEntry) {
    // Update existing entry to "Applied" status
    Logger.log(`  → Found existing entry, updating status to Applied`);
    updateNotionEntry(existingEntry.id, { status: 'Applied' }, config);
    return true;
  }

  // Create new entry
  const url = 'https://api.notion.com/v1/pages';

  // Format date for Notion
  const dateStr = Utilities.formatDate(data.applicationDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Build properties object
  const properties = {
    'Position': {
      title: [{ text: { content: data.position } }]  // Position is now the main field
    },
    'Company': {
      rich_text: [{ text: { content: data.company } }]
    },
    'Status': {
      select: { name: 'Applied' }  // Using select type for proper statuses
    },
    'Application Date': {
      date: { start: dateStr }
    },
    'Source': {
      select: { name: data.source }
    },
    'Email Subject': {
      rich_text: [{ text: { content: data.emailSubject.substring(0, 2000) } }]
    }
  };

  // Add Job URL if found
  if (data.jobUrl) {
    properties['Job URL'] = {
      url: data.jobUrl
    };
  }

  // Add Location if found
  if (data.location) {
    properties['Location'] = {
      rich_text: [{ text: { content: data.location } }]
    };
  }

  const payload = {
    parent: { database_id: config.NOTION_DATABASE_ID },
    properties: properties
  };

  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();

    if (responseCode === 200 || responseCode === 201) {
      Logger.log(`Created Notion entry for ${data.company} - ${data.position}`);
      return true;
    } else {
      Logger.log(`Failed to create Notion entry: ${response.getContentText()}`);
      return false;
    }
  } catch (error) {
    Logger.log(`Error creating Notion entry: ${error}`);
    return false;
  }
}

/**
 * Check if an entry already exists (to avoid duplicates)
 */
// ============================================
// SETUP & TRIGGER FUNCTIONS
// ============================================

/**
 * Set up hourly trigger to scan emails
 * Run this once to enable automatic scanning
 */
function setupTrigger() {
  // Remove existing triggers for this function
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'scanEmailsAndCreateEntries') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Create new hourly trigger
  ScriptApp.newTrigger('scanEmailsAndCreateEntries')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('Hourly trigger set up successfully');
}

/**
 * Remove the automatic trigger
 */
function removeTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'scanEmailsAndCreateEntries') {
      ScriptApp.deleteTrigger(trigger);
      Logger.log('Trigger removed');
    }
  }
}

/**
 * Test function - run this to verify your setup
 */
function testSetup() {
  const config = getConfig();

  Logger.log('=== Testing Configuration ===');
  Logger.log(`NOTION_TOKEN: ${config.NOTION_TOKEN ? 'Set (hidden)' : 'NOT SET'}`);
  Logger.log(`NOTION_DATABASE_ID: ${config.NOTION_DATABASE_ID ? config.NOTION_DATABASE_ID : 'NOT SET'}`);

  if (!config.NOTION_TOKEN || !config.NOTION_DATABASE_ID) {
    Logger.log('\nERROR: Please set both NOTION_TOKEN and NOTION_DATABASE_ID in Script Properties');
    Logger.log('Go to Project Settings > Script Properties to add them');
    return;
  }

  // Test Notion API connection
  Logger.log('\n=== Testing Notion Connection ===');
  const url = `https://api.notion.com/v1/databases/${config.NOTION_DATABASE_ID}`;

  const options = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${config.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28'
    },
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();

    if (responseCode === 200) {
      const data = JSON.parse(response.getContentText());
      Logger.log(`Connected to database: ${data.title[0]?.plain_text || 'Untitled'}`);
      Logger.log('Notion connection successful!');
    } else {
      Logger.log(`Notion API error (${responseCode}): ${response.getContentText()}`);
    }
  } catch (error) {
    Logger.log(`Error connecting to Notion: ${error}`);
  }

  // Test Gmail access
  Logger.log('\n=== Testing Gmail Access ===');
  try {
    const threads = GmailApp.search('subject:test', 0, 1);
    Logger.log('Gmail access successful!');
  } catch (error) {
    Logger.log(`Error accessing Gmail: ${error}`);
  }

  Logger.log('\n=== Setup Test Complete ===');
}

/**
 * Manual test - process last 7 days of emails
 */
function manualScan() {
  const config = getConfig();

  // Temporarily increase scan range
  const originalHours = config.HOURS_TO_SCAN;
  PropertiesService.getScriptProperties().setProperty('HOURS_TO_SCAN_TEMP', '168'); // 7 days

  scanEmailsAndCreateEntries();

  // Restore original
  PropertiesService.getScriptProperties().deleteProperty('HOURS_TO_SCAN_TEMP');
}

/**
 * Remove the processed label from recent emails to re-scan them
 */
function clearProcessedLabels() {
  const config = getConfig();
  const label = GmailApp.getUserLabelByName(config.PROCESSED_LABEL);

  if (!label) {
    Logger.log('No processed label found');
    return;
  }

  const threads = label.getThreads(0, 100);
  Logger.log(`Found ${threads.length} threads with processed label`);

  label.removeFromThreads(threads);
  Logger.log('Removed processed labels - ready to re-scan');
}

/**
 * Create a brand new Job Application Tracker database with proper structure
 * Run this once to set up a new database
 */
function createNewDatabase() {
  const config = getConfig();

  // First, we need a parent page ID. Let's get the user's root pages
  const searchUrl = 'https://api.notion.com/v1/search';
  const searchOptions = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    payload: JSON.stringify({
      filter: { property: 'object', value: 'page' },
      page_size: 1
    }),
    muteHttpExceptions: true
  };

  // Get a parent page
  const searchResponse = UrlFetchApp.fetch(searchUrl, searchOptions);
  const searchData = JSON.parse(searchResponse.getContentText());

  if (!searchData.results || searchData.results.length === 0) {
    Logger.log('ERROR: Could not find a parent page. Creating database in workspace root.');
    Logger.log('You will need to manually share your integration with the database after creation.');
  }

  const parentId = searchData.results[0]?.id;

  // Create the database
  const createUrl = 'https://api.notion.com/v1/databases';

  const databaseSchema = {
    parent: parentId ? { type: 'page_id', page_id: parentId } : { type: 'workspace', workspace: true },
    title: [
      {
        type: 'text',
        text: { content: 'Job Application Tracker' }
      }
    ],
    properties: {
      'Position': {
        title: {}  // This is the main/title field
      },
      'Company': {
        rich_text: {}
      },
      'Status': {
        select: {
          options: [
            { name: 'Applied', color: 'blue' },
            { name: 'Screening', color: 'purple' },
            { name: 'Interview', color: 'yellow' },
            { name: 'Offer', color: 'green' },
            { name: 'Rejected', color: 'red' },
            { name: 'Ghosted', color: 'gray' }
          ]
        }
      },
      'Application Date': {
        date: {}
      },
      'Source': {
        select: {
          options: [
            { name: 'LinkedIn', color: 'blue' },
            { name: 'Indeed', color: 'purple' },
            { name: 'ZipRecruiter', color: 'pink' },
            { name: 'Glassdoor', color: 'green' },
            { name: 'Company Website', color: 'orange' },
            { name: 'Referral', color: 'yellow' },
            { name: 'Other', color: 'gray' }
          ]
        }
      },
      'Job URL': {
        url: {}
      },
      'Location': {
        rich_text: {}
      },
      'Email Subject': {
        rich_text: {}
      },
      'Notes': {
        rich_text: {}
      }
    }
  };

  const createOptions = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    payload: JSON.stringify(databaseSchema),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(createUrl, createOptions);
    const responseCode = response.getResponseCode();
    const data = JSON.parse(response.getContentText());

    if (responseCode === 200) {
      const newDbId = data.id.replace(/-/g, '');

      Logger.log('✅ SUCCESS! New database created!');
      Logger.log('');
      Logger.log('Database ID: ' + newDbId);
      Logger.log('Direct link: https://notion.so/' + newDbId);
      Logger.log('');
      Logger.log('🔧 NEXT STEPS:');
      Logger.log('1. Run updateDatabaseId("' + newDbId + '") to update the script');
      Logger.log('2. Then run clearProcessedLabels() to reset');
      Logger.log('3. Then run scanEmailsAndCreateEntries() to import');

      return newDbId;
    } else {
      Logger.log('ERROR: ' + response.getContentText());
      return null;
    }
  } catch (error) {
    Logger.log('ERROR: ' + error);
    return null;
  }
}

/**
 * Update the database ID in script properties
 */
function updateDatabaseId(newDatabaseId) {
  PropertiesService.getScriptProperties().setProperty('NOTION_DATABASE_ID', newDatabaseId);
  Logger.log('✅ Database ID updated!');
  Logger.log('New ID: ' + newDatabaseId);
}

/**
 * Complete setup - updates database ID, clears labels, and scans emails
 * Run this after creating a new database
 */
function completeSetup(databaseId) {
  if (!databaseId) {
    Logger.log('ERROR: Please provide database ID from createNewDatabase output');
    Logger.log('Usage: completeSetup("your-database-id-here")');
    return;
  }

  Logger.log('=== COMPLETE SETUP ===');
  Logger.log('');

  // Step 1: Update database ID
  Logger.log('Step 1: Updating database ID...');
  updateDatabaseId(databaseId);

  // Step 2: Clear processed labels
  Logger.log('');
  Logger.log('Step 2: Clearing processed labels...');
  clearProcessedLabels();

  // Step 3: Scan emails
  Logger.log('');
  Logger.log('Step 3: Scanning emails...');
  scanEmailsAndCreateEntries();

  Logger.log('');
  Logger.log('✅ SETUP COMPLETE!');
  const cleanId = databaseId.replace(/-/g, '');
  Logger.log('Check your new database: https://notion.so/' + cleanId);
}

/**
 * Scrape job details from URLs in the database
 * Looks for entries with URLs but missing company/position info
 */
function scrapeJobURLs() {
  const config = getConfig();
  const queryUrl = `https://api.notion.com/v1/databases/${config.NOTION_DATABASE_ID}/query`;

  // Query for entries with URLs but unknown company/position
  const queryPayload = {
    filter: {
      and: [
        {
          property: 'Job URL',
          url: { is_not_empty: true }
        },
        {
          or: [
            { property: 'Position', title: { contains: 'Unknown' } },
            { property: 'Company', rich_text: { contains: 'Unknown' } }
          ]
        }
      ]
    }
  };

  const queryOptions = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    payload: JSON.stringify(queryPayload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(queryUrl, queryOptions);
    const data = JSON.parse(response.getContentText());

    if (!data.results || data.results.length === 0) {
      Logger.log('No entries with URLs to scrape');
      return;
    }

    Logger.log(`Found ${data.results.length} entries to scrape`);

    for (const page of data.results) {
      const pageId = page.id;
      const jobUrl = page.properties['Job URL']?.url;

      if (!jobUrl) continue;

      Logger.log(`\nScraping: ${jobUrl}`);

      try {
        const jobDetails = scrapeJobPage(jobUrl);

        if (jobDetails.company || jobDetails.position) {
          updateNotionEntry(pageId, jobDetails, config);
          Logger.log(`  ✓ Updated: ${jobDetails.company || 'Unknown'} - ${jobDetails.position || 'Unknown'}`);
        } else {
          Logger.log(`  ✗ Could not extract details`);
        }
      } catch (error) {
        Logger.log(`  ✗ Error: ${error}`);
      }

      Utilities.sleep(2000); // Rate limiting
    }

  } catch (error) {
    Logger.log('Error querying database: ' + error);
  }
}

/**
 * Scrape job details from a URL
 */
function scrapeJobPage(url) {
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const html = response.getContentText();

    let company = null;
    let position = null;
    let location = null;

    // LinkedIn
    if (url.includes('linkedin.com')) {
      let match = html.match(/<title>(.+?)\s*-\s*(.+?)\s*-\s*LinkedIn<\/title>/i);
      if (match) {
        position = match[1].trim();
        company = match[2].trim();
      }
    }

    // Indeed
    if (url.includes('indeed.com')) {
      let match = html.match(/<h1[^>]*class="[^"]*jobsearch-JobInfoHeader-title[^"]*"[^>]*>(.+?)<\/h1>/i);
      if (match) position = match[1].replace(/<[^>]*>/g, '').trim();

      match = html.match(/companyName['"]\s*:\s*['"]([^'"]+)['"]/i);
      if (match) company = match[1].trim();
    }

    // Greenhouse
    if (url.includes('greenhouse.io') || url.includes('boards.greenhouse.io')) {
      let match = html.match(/<h1[^>]*class="[^"]*app-title[^"]*"[^>]*>(.+?)<\/h1>/i);
      if (match) position = match[1].replace(/<[^>]*>/g, '').trim();

      match = html.match(/<span[^>]*class="[^"]*company-name[^"]*"[^>]*>(.+?)<\/span>/i);
      if (match) company = match[1].replace(/<[^>]*>/g, '').trim();
    }

    // Lever
    if (url.includes('lever.co')) {
      let match = html.match(/<h2[^>]*>(.+?)<\/h2>/i);
      if (match) position = match[1].replace(/<[^>]*>/g, '').trim();

      match = html.match(/<title>(.+?)\s*-\s*(.+?)<\/title>/i);
      if (match) company = match[2].trim();
    }

    // Generic fallback
    if (!position || !company) {
      let match = html.match(/<title>(.+?)<\/title>/i);
      if (match) {
        const title = match[1];
        const parts = title.split(/\s*[-|]\s*/);
        if (parts.length >= 2) {
          position = position || parts[0].trim();
          company = company || parts[1].trim();
        }
      }
    }

    return {
      company: company,
      position: position,
      location: location
    };

  } catch (error) {
    Logger.log(`Scraping error: ${error}`);
    return { company: null, position: null, location: null };
  }
}

/**
 * Find existing entry by company name
 */
function findExistingEntry(companyName, config) {
  if (!companyName || companyName === 'Unknown Company') {
    return null;
  }

  const queryUrl = `https://api.notion.com/v1/databases/${config.NOTION_DATABASE_ID}/query`;

  const queryPayload = {
    filter: {
      property: 'Company',
      rich_text: { contains: companyName }
    },
    page_size: 5
  };

  const queryOptions = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    payload: JSON.stringify(queryPayload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(queryUrl, queryOptions);
    const data = JSON.parse(response.getContentText());

    if (data.results && data.results.length > 0) {
      // Return the first matching entry
      return data.results[0];
    }
  } catch (error) {
    Logger.log(`  Error finding existing entry: ${error}`);
  }

  return null;
}

/**
 * Update an existing Notion entry
 */
function updateNotionEntry(pageId, data, config) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;

  const properties = {};

  if (data.company) {
    properties['Company'] = {
      rich_text: [{ text: { content: data.company } }]
    };
  }

  if (data.position) {
    properties['Position'] = {
      title: [{ text: { content: data.position } }]
    };
  }

  if (data.location) {
    properties['Location'] = {
      rich_text: [{ text: { content: data.location } }]
    };
  }

  if (data.status) {
    properties['Status'] = {
      select: { name: data.status }
    };
  }

  const payload = {
    properties: properties
  };

  const options = {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${config.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    UrlFetchApp.fetch(url, options);
  } catch (error) {
    Logger.log(`Error updating entry: ${error}`);
  }
}

/**
 * Diagnostic function to check what emails are being found
 */
function diagnosticScan() {
  const config = getConfig();

  Logger.log('=== DIAGNOSTIC SCAN ===');
  Logger.log('NOTION_TOKEN set: ' + (config.NOTION_TOKEN ? 'YES' : 'NO'));
  Logger.log('NOTION_DATABASE_ID set: ' + (config.NOTION_DATABASE_ID ? 'YES' : 'NO'));

  // Search last 30 days for ANY application emails
  const searchQuery = 'subject:(application OR applied OR "thank you for applying") newer_than:30d';
  Logger.log('Search query: ' + searchQuery);

  const threads = GmailApp.search(searchQuery, 0, 50);
  Logger.log('Total emails found: ' + threads.length);

  // Show first 10 subject lines
  for (let i = 0; i < Math.min(10, threads.length); i++) {
    const messages = threads[i].getMessages();
    Logger.log((i+1) + '. ' + messages[0].getSubject() + ' - FROM: ' + messages[0].getFrom());
  }

  Logger.log('=== END DIAGNOSTIC ===');
}

/**
 * Show the Notion database URL
 */
function showNotionDatabaseURL() {
  const config = getConfig();
  const dbId = config.NOTION_DATABASE_ID;

  if (!dbId) {
    Logger.log('ERROR: NOTION_DATABASE_ID not set!');
    return;
  }

  // Remove dashes from ID if present
  const cleanId = dbId.replace(/-/g, '');

  Logger.log('=== YOUR NOTION DATABASE ===');
  Logger.log('Database ID: ' + dbId);
  Logger.log('Direct link: https://notion.so/' + cleanId);
  Logger.log('');
  Logger.log('👉 CLICK THIS LINK to open your Job Application Tracker database');
  Logger.log('https://notion.so/' + cleanId);
}

/**
 * Check the actual schema of your Notion database
 */
function checkNotionSchema() {
  const config = getConfig();
  const url = `https://api.notion.com/v1/databases/${config.NOTION_DATABASE_ID}`;

  const options = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${config.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28'
    },
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());

    Logger.log('=== NOTION DATABASE SCHEMA ===');
    Logger.log('Database: ' + data.title[0]?.plain_text);
    Logger.log('\nProperties:');

    for (const [name, prop] of Object.entries(data.properties)) {
      Logger.log(`  "${name}" - Type: ${prop.type}`);

      if (prop.type === 'select' && prop.select?.options) {
        const options = prop.select.options.map(o => o.name).join(', ');
        Logger.log(`    Options: ${options}`);
      }

      if (prop.type === 'status' && prop.status?.options) {
        const options = prop.status.options.map(o => o.name).join(', ');
        Logger.log(`    Status options: ${options}`);
      }
    }

    Logger.log('\n=== REQUIRED FOR SCRIPT ===');
    Logger.log('The script needs these properties:');
    Logger.log('  - Position (type: title)');
    Logger.log('  - Company (type: rich_text)');
    Logger.log('  - Status (type: select) with "Applied" option');
    Logger.log('  - Application Date (type: date)');
    Logger.log('  - Source (type: select)');
    Logger.log('  - Email Subject (type: rich_text)');

  } catch (error) {
    Logger.log('Error: ' + error);
  }
}
