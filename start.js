const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log(`
  _    _                                         _
 | |  | |                                       | |
 | |__| | __ _ _   _ _ __ ___   ___   ___   ___ | |
 |  __  |/ _\` | | | | '_ \` _ \\ / _ \\ / _ \\ / _ \\| |
 | |  | | (_| | |_| | | | | | | (_) | (_) | (_) | |
 |_|  |_|\\__,_|\\__, |_| |_| |_|\\___/ \\___/ \\___/|_|
                __/ |
               |___/
`);

console.log('==================================');
console.log('    Starting Bot Status Monitor    ');
console.log('==================================\n');

const REPO_URL = 'https://github.com/Haymooed/AutoStatus-Bot.git';
const BRANCH = process.env.GIT_BRANCH || 'main';
const SKIP_UPDATE = process.env.SKIP_UPDATE === '1';

function run(cmd, opts = {}) {
    execSync(cmd, { stdio: 'inherit', shell: true, ...opts });
}

function hashFile(p) {
    if (!fs.existsSync(p)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// ── Update repo ─────────────────────────────────────────────────────────────
if (SKIP_UPDATE) {
    console.log('⏭️  SKIP_UPDATE=1 — skipping git update.\n');
} else {
    try {
        if (!fs.existsSync('.git')) {
            console.log('📦 Initializing git repository...');
            run('git init');
            run(`git remote add origin ${REPO_URL}`);
            run(`git fetch --depth=1 origin ${BRANCH}`);
            run(`git checkout -t origin/${BRANCH} -f`);
        } else {
            console.log(`📥 Syncing with origin/${BRANCH}...`);
            run(`git fetch origin ${BRANCH}`);
            // Always hard-reset to remote — guarantees convergence even
            // after force-pushes, divergent branches, or local edits.
            run(`git reset --hard origin/${BRANCH}`);
            run('git clean -fd');
        }
        console.log('✅ Repo up to date.\n');
    } catch (error) {
        console.error('⚠️ Failed to update from git:', error.message, '\n');
    }
}

// ── Install dependencies (only if lockfile changed) ─────────────────────────
try {
    const lockPath = path.join(process.cwd(), 'package-lock.json');
    const stampPath = path.join(process.cwd(), 'node_modules', '.install-stamp');
    const lockHash = hashFile(lockPath);
    const stamp = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8') : null;
    const needsInstall =
        !fs.existsSync('node_modules') ||
        !stamp ||
        (lockHash && stamp !== lockHash);

    if (needsInstall) {
        console.log('📦 Installing dependencies...');
        run('npm install --no-audit --no-fund --prefer-offline');
        if (lockHash) fs.writeFileSync(stampPath, lockHash);
        console.log('✅ Dependencies installed.\n');
    } else {
        console.log('✅ Dependencies up to date, skipping install.\n');
    }
} catch (error) {
    console.error('⚠️ Failed to install dependencies:', error.message, '\n');
}

// ── Start the bot ───────────────────────────────────────────────────────────
console.log('🚀 Starting the bot...\n');
const bot = spawn('node', ['src/index.js'], { stdio: 'inherit' });

bot.on('close', (code) => {
    console.log(`\nBot process exited with code ${code}`);
    process.exit(code ?? 0);
});

process.on('SIGINT',  () => bot.kill('SIGINT'));
process.on('SIGTERM', () => bot.kill('SIGTERM'));

// Built by Haymooed
