# Complete GitHub Repository Setup Guide

## Current Status
- ✅ Project files ready
- ⚠️ `.git` directory is locked (Cursor is using it)
- ⚠️ GitHub CLI needs authentication (web browser blocked by proxy)

## Quick Solution

### Option 1: Run the Automated Script (Recommended)

1. **Close Cursor** (to release .git locks)
2. **Open PowerShell** (as Administrator if needed)
3. **Run:**
   ```powershell
   cd "d:\Dev\Projects\Tank Arena"
   .\setup-github.ps1
   ```
4. **When prompted for authentication**, choose option 1 (Token) and follow the instructions

### Option 2: Manual Token Authentication

1. **Get a GitHub Personal Access Token:**
   - Go to: https://github.com/settings/tokens
   - Click "Generate new token" → "Generate new token (classic)"
   - Name: `Tank Arena Setup`
   - Expiration: Choose your preference
   - Select scope: ✅ **`repo`** (Full control of private repositories)
   - Click "Generate token"
   - **Copy the token immediately** (you won't see it again!)

2. **Authenticate GitHub CLI:**
   ```powershell
   cd "d:\Dev\Projects\Tank Arena"
   echo YOUR_TOKEN_HERE | & "C:\Program Files\GitHub CLI\gh.exe" auth login --with-token
   ```
   (Replace `YOUR_TOKEN_HERE` with your actual token)

3. **Close Cursor**, then run:
   ```powershell
   .\setup-github.ps1
   ```

### Option 3: Complete Manual Setup

1. **Close Cursor**

2. **Remove .git directory:**
   ```powershell
   cd "d:\Dev\Projects\Tank Arena"
   Remove-Item .git -Recurse -Force
   ```

3. **Initialize git:**
   ```powershell
   & "C:\Program Files\Git\cmd\git.exe" init
   & "C:\Program Files\Git\cmd\git.exe" branch -M main
   & "C:\Program Files\Git\cmd\git.exe" add .
   & "C:\Program Files\Git\cmd\git.exe" commit -m "Initial commit"
   ```

4. **Authenticate GitHub CLI** (use token method from Option 2)

5. **Create GitHub repository:**
   ```powershell
   & "C:\Program Files\GitHub CLI\gh.exe" repo create Tank-Arena --public --description "A tank arena game project" --source=. --remote=origin --push
   ```

## What the Script Does

The `setup-github.ps1` script will:
1. ✅ Clean up locked .git directory
2. ✅ Initialize git repository
3. ✅ Add and commit all files
4. ✅ Handle GitHub CLI authentication (interactive)
5. ✅ Create GitHub repository and push code

## Troubleshooting

**If .git is still locked:**
- Close all applications (Cursor, VS Code, Git GUI tools)
- Wait 10 seconds
- Try again

**If authentication fails:**
- Use token method (Option 2 above)
- Make sure token has `repo` scope
- Token must be a "classic" token, not fine-grained

**If repository creation fails:**
- Repository may already exist
- Check: https://github.com/YOUR_USERNAME/Tank-Arena
- If it exists, just connect: `git remote add origin https://github.com/YOUR_USERNAME/Tank-Arena.git`
