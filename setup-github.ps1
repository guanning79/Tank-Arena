# Complete GitHub Repository Setup
# This script will: initialize git, commit files, authenticate, and create the GitHub repo

Write-Host "=== GitHub Repository Setup ===" -ForegroundColor Cyan
Write-Host ""

$projectPath = "d:\Dev\Projects\Tank Arena"
cd $projectPath

# Step 1: Clean up .git directory if it exists and is locked
Write-Host "Step 1: Setting up local git repository..." -ForegroundColor Yellow
if (Test-Path .git) {
    Write-Host "  Found existing .git directory. Attempting to clean up..." -ForegroundColor Yellow
    
    # Remove lock files
    $lockFiles = @(".git\config.lock", ".git\index.lock", ".git\HEAD.lock")
    foreach ($lockFile in $lockFiles) {
        if (Test-Path $lockFile) {
            try {
                $file = Get-Item $lockFile -Force
                $file.IsReadOnly = $false
                Remove-Item $lockFile -Force -ErrorAction Stop
                Write-Host "    Removed $lockFile" -ForegroundColor Green
            } catch {
                Write-Host "    Warning: Could not remove $lockFile" -ForegroundColor Yellow
            }
        }
    }
    
    # Try to remove .git directory
    try {
        Remove-Item .git -Recurse -Force -ErrorAction Stop
        Write-Host "  Removed .git directory" -ForegroundColor Green
        Start-Sleep -Seconds 1
    } catch {
        Write-Host "  Error: Cannot remove .git directory. Please close Cursor/VS Code and run this script again." -ForegroundColor Red
        Write-Host "  Or manually delete the .git folder from File Explorer." -ForegroundColor Yellow
        exit 1
    }
}

# Initialize git
Write-Host "  Initializing git repository..." -ForegroundColor Cyan
& "C:\Program Files\Git\cmd\git.exe" init
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Error: Could not initialize git repository" -ForegroundColor Red
    exit 1
}

& "C:\Program Files\Git\cmd\git.exe" branch -M main
Write-Host "  Git repository initialized!" -ForegroundColor Green

# Add and commit files
Write-Host ""
Write-Host "Step 2: Adding and committing files..." -ForegroundColor Cyan
& "C:\Program Files\Git\cmd\git.exe" add .
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Error adding files" -ForegroundColor Red
    exit 1
}

& "C:\Program Files\Git\cmd\git.exe" commit -m "Initial commit"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Error committing files" -ForegroundColor Red
    exit 1
}
Write-Host "  Files committed successfully!" -ForegroundColor Green

# Step 3: GitHub CLI Authentication
Write-Host ""
Write-Host "Step 3: GitHub CLI Authentication..." -ForegroundColor Cyan
$authStatus = & "C:\Program Files\GitHub CLI\gh.exe" auth status 2>&1

if ($LASTEXITCODE -ne 0 -or $authStatus -match "Failed to log in" -or $authStatus -match "invalid") {
    Write-Host "  GitHub CLI needs authentication." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Please choose an authentication method:" -ForegroundColor White
    Write-Host "  1. Token authentication (recommended)" -ForegroundColor Cyan
    Write-Host "  2. Web browser authentication" -ForegroundColor Cyan
    Write-Host ""
    
    $choice = Read-Host "Enter choice (1 or 2)"
    
    if ($choice -eq "1") {
        Write-Host ""
        Write-Host "  To get a token:" -ForegroundColor Yellow
        Write-Host "  1. Go to: https://github.com/settings/tokens" -ForegroundColor White
        Write-Host "  2. Click 'Generate new token' -> 'Generate new token (classic)'" -ForegroundColor White
        Write-Host "  3. Name: 'Tank Arena Setup'" -ForegroundColor White
        Write-Host "  4. Select scope: 'repo' (full control of private repositories)" -ForegroundColor White
        Write-Host "  5. Click 'Generate token' and copy it" -ForegroundColor White
        Write-Host ""
        $token = Read-Host "  Paste your token here" -AsSecureString
        $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
        $plainToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
        
        Write-Host "  Authenticating..." -ForegroundColor Cyan
        echo $plainToken | & "C:\Program Files\GitHub CLI\gh.exe" auth login --with-token
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Error: Authentication failed" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "  Attempting web browser authentication..." -ForegroundColor Cyan
        & "C:\Program Files\GitHub CLI\gh.exe" auth login --hostname github.com --git-protocol https --web
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Web authentication failed. Please use token authentication instead." -ForegroundColor Red
            exit 1
        }
    }
    
    Write-Host "  Authentication successful!" -ForegroundColor Green
} else {
    Write-Host "  Already authenticated!" -ForegroundColor Green
}

# Step 4: Create GitHub repository
Write-Host ""
Write-Host "Step 4: Creating GitHub repository..." -ForegroundColor Cyan
$repoOutput = & "C:\Program Files\GitHub CLI\gh.exe" repo create Tank-Arena --public --description "A tank arena game project" --source=. --remote=origin --push 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=== SUCCESS! ===" -ForegroundColor Green
    Write-Host "Repository created and pushed to GitHub!" -ForegroundColor Green
    if ($repoOutput) {
        Write-Host "Repository URL: $repoOutput" -ForegroundColor Cyan
    } else {
        Write-Host "Repository URL: https://github.com/$(gh api user --jq .login)/Tank-Arena" -ForegroundColor Cyan
    }
} else {
    Write-Host "  Error creating repository. It may already exist." -ForegroundColor Red
    Write-Host "  Repository output: $repoOutput" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  You can manually create it at: https://github.com/new" -ForegroundColor Yellow
    Write-Host "  Then run:" -ForegroundColor Yellow
    Write-Host "    git remote add origin https://github.com/YOUR_USERNAME/Tank-Arena.git" -ForegroundColor White
    Write-Host "    git push -u origin main" -ForegroundColor White
}
