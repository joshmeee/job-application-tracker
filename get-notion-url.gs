/**
 * QUICK START: Run this function to get your Notion database URL
 * 
 * Instructions:
 * 1. In Google Apps Script editor, click on "get-notion-url.gs"
 * 2. Select the function "getMyNotionURL" from the dropdown at the top
 * 3. Click the Run button (▶)
 * 4. Check the "Execution log" at the bottom - you'll see your Notion link
 */

function getMyNotionURL() {
  const props = PropertiesService.getScriptProperties();
  const dbId = props.getProperty('NOTION_DATABASE_ID');
  
  if (!dbId) {
    Logger.log('❌ ERROR: NOTION_DATABASE_ID not set!');
    Logger.log('');
    Logger.log('Please set your NOTION_DATABASE_ID first:');
    Logger.log('1. Go to Project Settings (gear icon on left)');
    Logger.log('2. Scroll to "Script Properties"');
    Logger.log('3. Add NOTION_DATABASE_ID with your database ID');
    return;
  }
  
  // Remove dashes from ID if present
  const cleanId = dbId.replace(/-/g, '');
  
  Logger.log('');
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('         YOUR JOB APPLICATION TRACKER          ');
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('');
  Logger.log('👉 Click this link to open your Notion database:');
  Logger.log('');
  Logger.log('   https://notion.so/' + cleanId);
  Logger.log('');
  Logger.log('Database ID: ' + dbId);
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('');
}
