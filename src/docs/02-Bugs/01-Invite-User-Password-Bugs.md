# Invite User Password Bugs

# Role: Senior Debugger & Investigator
I have discovered this bug while testing the application in the browser, but I do not know which specific files, components, or lines of code are responsible.

Your objective is to map my browser-level symptoms to the codebase, identify the root cause, and implement a fix.

# The Bug Report
Here are the clues from my browser session. Use your search tools (`grep`, AST parsing, etc.) to locate the relevant code based on these details:

**1. Steps to Reproduce:**
- Go to settings and invite a user.
- Check the email invitations.
- Copy and paste the user email and temporary password to the login/activation page.

**2. Expected Behavior:**
- After login with the temporary password, it should work and allow login successfully.

**3. Actual (Buggy) Behavior:**
- The password is always failed.


# Execution Plan
Please follow these steps strictly. Do not jump straight to writing code.

**Phase 1: Investigation**
Search the codebase using the clues above. Look for the UI components rendering the text, the state management handling the interaction, or the API routes being called. 

**Phase 2: Root Cause Analysis**
Before modifying any files, briefly explain to me what you found. State which file is causing the issue and explain the logical flaw.

**Phase 3: The Fix**
Once you have identified the root cause, implement the fix. 

# Strict Constraints
- **Keep it Minimal:** Do not rewrite entire components or refactor architecture to fix this bug. Change only what is absolutely necessary.
- **No Regressions:** Ensure your fix does not break the surrounding logic or state flow.
- **Check Your Work:** If there are unit tests related to this file, run them. Ensure there are no syntax or linter errors before completing the task.
- There is no violation against the manifest, coding standards, and AI interaction.
- There is no error when building. 
- There is no error showing in the Next.js dev tools.