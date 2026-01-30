# Job Application Tracker

Automatically track your job applications by scanning Gmail confirmation emails and creating entries in a Notion database.

## Features

✅ **Automatic Email Scanning**
- Scans Gmail hourly for job application confirmation emails
- Detects applications from LinkedIn, Indeed, Glassdoor, and major ATS platforms
- Extracts company name, position, application date, and source

✅ **Smart Status Management**
- Auto-updates entries from "In progress" → "Applied" when confirmation emails arrive
- Prevents duplicate entries

✅ **URL Scraping**
- Paste job URLs before applying
- Automatically scrapes and populates company, position, and location details
- Works with LinkedIn, Indeed, Greenhouse, Lever, and more

✅ **Notion Integration**
- Clean database with Position as the main field
- Proper job application statuses (Applied, Screening, Interview, Offer, Rejected, Ghosted)
- Tracks URLs, locations, application dates, and notes

---

## Quick Start

### Prerequisites

- Gmail account
- Notion account
- Google Apps Script access

### Setup (15 minutes)

#### 1. Create Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **+ New integration**
3. Name it "Job Application Tracker"
4. Select your workspace
5. Click **Submit**
6. Copy the **Internal Integration Token** (starts with `secret_`)

#### 2. Set Up Google Apps Script

1. Go to [https://script.google.com](https://script.google.com)
2. Click **+ New project**
3. Name it "Job Application Tracker"
4. Delete the default code
5. Copy and paste the entire contents of `Code.gs` from this repository
6. Click **Save** (Ctrl+S / Cmd+S)

#### 3. Add Script Properties

1. Click the **⚙ gear icon** (Project Settings)
2. Scroll to **Script Properties**
3. Click **Add script property** and add:

| Property | Value |
|----------|-------|
| `NOTION_TOKEN` | Your integration token from step 1 |

#### 4. Authorize the Script

1. Go back to the **Editor** tab
2. Select `testSetup` from the function dropdown
3. Click **Run**
4. Click **Review permissions**
5. Select your Google account
6. Click **Advanced** → **Go to Job Application Tracker (unsafe)**
7. Click **Allow**

#### 5. Create Notion Database

1. Select `createNewDatabase` from the function dropdown
2. Click **Run**
3. Check the Execution log (View → Executions)
4. Copy the database ID from the log

#### 6. Complete Setup

1. Select `completeSetup` from the function dropdown
2. In the code editor, temporarily add this at the bottom:
   ```javascript
   function runSetup() {
     completeSetup("YOUR-DATABASE-ID-HERE");
   }
   ```
3. Replace `YOUR-DATABASE-ID-HERE` with the ID from step 5
4. Select `runSetup` and click **Run**
5. Delete the `runSetup` function after it completes

#### 7. Enable Hourly Scanning

1. Select `setupTrigger` from the function dropdown
2. Click **Run**

Done! The script will now scan your Gmail every hour automatically.

---

## Usage

### Automatic Mode (Default)

Once set up, the script runs every hour automatically:
- Scans last 24 hours of Gmail
- Finds job application confirmations
- Creates Notion entries OR updates existing ones
- Labels processed emails as "JobTracker/Processed"

### Manual Tracking (Before Applying)

1. **Add a row in Notion** with:
   - Position: (leave blank or "Unknown")
   - Company: (leave blank or "Unknown")
   - Job URL: (paste the job posting URL)
   - Status: "In progress"

2. **Run `scrapeJobURLs` in Apps Script** to auto-populate:
   - Company name
   - Position title
   - Location

3. **When you apply**, the confirmation email will:
   - Find your existing entry
   - Update status to "Applied"
   - No duplicates!

### Manual Scanning

To manually scan emails:
- Run `scanEmailsAndCreateEntries` - scans last 24 hours
- Run `manualScan` - scans last 7 days

---

## Supported Platforms

### Job Boards
- LinkedIn
- Indeed
- Glassdoor
- ZipRecruiter
- Monster
- CareerBuilder

### ATS Platforms
- Greenhouse
- Lever
- Workday
- SmartRecruiters
- iCIMS
- Jobvite
- BambooHR
- Ashby
- JazzHR
- Taleo
- SuccessFactors
- Workable

---

## Notion Database Schema

| Property | Type | Description |
|----------|------|-------------|
| Position | Title | Job title (main field) |
| Company | Text | Company name |
| Status | Select | Applied, Screening, Interview, Offer, Rejected, Ghosted |
| Application Date | Date | When you applied |
| Source | Select | LinkedIn, Indeed, Company Website, etc. |
| Job URL | URL | Link to job posting |
| Location | Text | Job location |
| Email Subject | Text | Original confirmation email subject |
| Notes | Text | Your notes |

---

## Customization

### Add New Email Patterns

Edit the `EMAIL_PATTERNS` array in `Code.gs` to add support for new job boards or ATS platforms.

### Change Scan Frequency

Modify the `setupTrigger` function:
- `.everyHours(2)` for every 2 hours
- `.everyMinutes(30)` for every 30 minutes (not recommended)
- `.everyDays(1).atHour(9)` for daily at 9 AM

### Adjust Time Window

Change `HOURS_TO_SCAN` in the `getConfig()` function:
- Default: `24` (1 day)
- For weekly: `168` (7 days)

---

## Troubleshooting

### No Emails Being Detected

1. Check execution logs: **Executions** in left sidebar
2. Verify email subject matches patterns
3. Run `diagnosticScan` to see what emails are found
4. Check if emails already have "JobTracker/Processed" label

### Notion API Errors

- **401 Unauthorized**: Invalid or expired integration token
- **404 Not Found**: Database ID incorrect or integration not connected to database
- **400 Validation Error**: Database schema doesn't match (check Status field type)

### Duplicates

The script labels processed emails. If you see duplicates:
- Labels were removed from emails
- Run `clearProcessedLabels` then re-scan

---

## Privacy & Security

- Your Notion token is stored in Script Properties (encrypted by Google)
- The script only reads email metadata for job application detection
- Only writes to your specified Notion database
- No data is sent to third parties
- All processing happens in your Google Apps Script environment

---

## Contributing

Issues and pull requests welcome! To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

## License

MIT License - feel free to use and modify for your job search!

---

## Credits

Built with ❤️ to help job seekers stay organized.

If this helped you land a job, consider giving it a ⭐ on GitHub!

---

## Changelog

### v1.0.0 (2026-01-29)
- Initial release
- Automatic email scanning
- Notion database integration
- URL scraping feature
- Smart status updates
- Support for major job boards and ATS platforms
