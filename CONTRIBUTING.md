# Contributing to Job Application Tracker

Thank you for considering contributing! This project helps job seekers stay organized, and your contributions make it better for everyone.

## How to Contribute

### Reporting Bugs

Found a bug? Please [open an issue](https://github.com/joshmeee/job-application-tracker/issues/new?template=bug_report.md) with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Error messages from execution logs
- Your environment (Google Apps Script version, etc.)

### Suggesting Features

Have an idea? [Open a feature request](https://github.com/joshmeee/job-application-tracker/issues/new?template=feature_request.md) describing:
- The feature and its benefits
- Use cases it would solve
- How you envision it working

### Asking Questions

Need help? [Open a question issue](https://github.com/joshmeee/job-application-tracker/issues/new?template=question.md) and we'll help you out!

## Development Setup

### Prerequisites
- Gmail account
- Notion account
- Google Apps Script access
- Text editor (VS Code, Sublime, etc.)

### Local Development

1. **Fork the repository**
   ```bash
   # On GitHub, click Fork
   git clone https://github.com/YOUR-USERNAME/job-application-tracker.git
   cd job-application-tracker
   ```

2. **Set up Google Apps Script**
   - Create a new Apps Script project
   - Install [clasp](https://github.com/google/clasp): `npm install -g @google/clasp`
   - Login: `clasp login`
   - Link to your project: `clasp create --title "Job Tracker Dev"`
   - Push code: `clasp push`

3. **Test your changes**
   - Set up script properties (NOTION_TOKEN, NOTION_DATABASE_ID)
   - Run test functions in Apps Script editor
   - Check execution logs for errors

### Making Changes

1. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow existing code style
   - Add comments for complex logic
   - Update README if adding features

3. **Test thoroughly**
   - Test with real Gmail data
   - Verify Notion integration works
   - Check execution logs for errors

4. **Commit with clear messages**
   ```bash
   git commit -m "feat: add support for new ATS platform"
   git commit -m "fix: handle missing email body gracefully"
   git commit -m "docs: update setup instructions"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then open a Pull Request on GitHub.

## Code Style

### JavaScript Style
- Use `const` and `let`, avoid `var`
- Use camelCase for variables and functions
- Use PascalCase for classes (if any)
- Add JSDoc comments for functions
- Keep functions focused and under 50 lines when possible

### Example
```javascript
/**
 * Extract company name from email body
 * @param {string} body - Email body text
 * @returns {string|null} Company name or null if not found
 */
function extractCompanyName(body) {
  const match = body.match(/company[:\s]+(.+?)(?:\n|$)/i);
  return match ? match[1].trim() : null;
}
```

### Commit Message Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

Examples:
- `feat: add Indeed job URL scraping support`
- `fix: handle emails with missing subject lines`
- `docs: clarify Notion integration setup steps`

## Adding Support for New Platforms

### Supporting a New Job Board

1. **Add domain to ATS_DOMAINS**
   ```javascript
   const ATS_DOMAINS = [
     // ... existing domains
     'newjobboard.com'
   ];
   ```

2. **Add email pattern**
   ```javascript
   {
     source: 'NewJobBoard',
     fromPatterns: ['noreply@newjobboard.com'],
     subjectPatterns: [
       /Your application to (.+)/i,
       /Thanks for applying/i
     ],
     extractInfo: function(subject, body) {
       // Custom extraction logic
       let company = null;
       let position = null;

       // Extract from subject or body
       const match = subject.match(/Your application to (.+) at (.+)/i);
       if (match) {
         position = match[1].trim();
         company = match[2].trim();
       }

       return { company, position };
     }
   }
   ```

3. **Test with real emails**
   - Forward test emails to yourself
   - Run the scanner
   - Verify extraction works

### Supporting New ATS Platforms

Similar process - add to `ATS_DOMAINS` and `EMAIL_PATTERNS`.

## Testing

### Manual Testing Checklist
- [ ] Email detection works for new platform
- [ ] Company and position extracted correctly
- [ ] Notion entry created successfully
- [ ] No duplicate entries created
- [ ] Status updates work correctly
- [ ] URL scraping works (if applicable)

### Test with Sample Emails
Create test emails with various formats to ensure robust parsing.

## Documentation

When adding features:
- Update README.md with new functionality
- Add examples to the documentation
- Update the "Supported Platforms" section if applicable
- Include screenshots for UI changes

## Pull Request Process

1. **Ensure your PR**:
   - Has a clear description
   - References related issues
   - Includes test results
   - Updates documentation
   - Follows code style guidelines

2. **PR Review**:
   - Maintainers will review within a few days
   - Address feedback and push updates
   - Once approved, it will be merged

3. **After Merge**:
   - Your contribution will be in the next release
   - You'll be added to contributors list
   - Thank you! 🎉

## Community

### Code of Conduct
Be respectful, inclusive, and constructive. We're all here to help job seekers succeed.

### Getting Help
- Open a question issue
- Check existing issues for answers
- Be patient - maintainers are volunteers

### Recognition
Contributors are listed in:
- GitHub contributors page
- Release notes
- README (for significant contributions)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for making job searching easier for everyone!** 🚀

If you landed a job using this tool, consider giving the repo a ⭐!
