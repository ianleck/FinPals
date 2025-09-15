#!/usr/bin/env tsx

/**
 * Codebase Health Check Script
 * Run with: npx tsx scripts/codebase-health-check.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface HealthCheckResult {
  category: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: string[];
}

class CodebaseHealthCheck {
  private results: HealthCheckResult[] = [];

  async runAllChecks(): Promise<void> {
    console.log('🏥 Running Codebase Health Check...\n');

    await this.checkSQLInjectionVulnerabilities();
    await this.checkTypeScriptCompilation();
    await this.checkTestSuite();
    await this.checkFileSizes();
    await this.checkImports();
    await this.checkErrorHandling();
    await this.checkTODOs();
    await this.checkDependencies();
    await this.checkSecurityPatterns();

    this.printReport();
  }

  private async checkSQLInjectionVulnerabilities(): Promise<void> {
    const vulnerablePattern = /sql`[^`]*\$\{[^}]+\}\s+IN\s+\$\{[^}]+\}`/g;
    const files = this.getAllTypeScriptFiles();
    const vulnerableFiles: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (vulnerablePattern.test(content)) {
        vulnerableFiles.push(file);
      }
    }

    this.results.push({
      category: '🔒 SQL Injection',
      status: vulnerableFiles.length > 0 ? 'fail' : 'pass',
      message: vulnerableFiles.length > 0
        ? `Found ${vulnerableFiles.length} files with SQL injection vulnerabilities`
        : 'No SQL injection vulnerabilities detected',
      details: vulnerableFiles
    });
  }

  private async checkTypeScriptCompilation(): Promise<void> {
    try {
      execSync('npx tsc --noEmit', { stdio: 'pipe' });
      this.results.push({
        category: '📘 TypeScript',
        status: 'pass',
        message: 'TypeScript compilation successful'
      });
    } catch (error: any) {
      const errorOutput = error.stdout?.toString() || error.stderr?.toString() || '';
      const errorCount = (errorOutput.match(/error TS/g) || []).length;

      this.results.push({
        category: '📘 TypeScript',
        status: 'fail',
        message: `TypeScript compilation failed with ${errorCount} errors`,
        details: errorOutput.split('\n').slice(0, 5)
      });
    }
  }

  private async checkTestSuite(): Promise<void> {
    try {
      const output = execSync('npm test -- --run', { stdio: 'pipe' }).toString();
      const passed = output.includes('passed');
      const testMatch = output.match(/(\d+) passed/);
      const passedCount = testMatch ? testMatch[1] : '0';

      this.results.push({
        category: '🧪 Tests',
        status: passed ? 'pass' : 'fail',
        message: `${passedCount} tests passed`
      });
    } catch (error) {
      this.results.push({
        category: '🧪 Tests',
        status: 'fail',
        message: 'Test suite failed to run'
      });
    }
  }

  private async checkFileSizes(): Promise<void> {
    const indexPath = path.join(process.cwd(), 'src/index.ts');
    const stats = fs.statSync(indexPath);
    const lines = fs.readFileSync(indexPath, 'utf-8').split('\n').length;

    this.results.push({
      category: '📏 File Size',
      status: lines > 500 ? 'warning' : 'pass',
      message: `index.ts has ${lines} lines`,
      details: lines > 500 ? ['Consider refactoring - file is too large'] : undefined
    });
  }

  private async checkImports(): Promise<void> {
    const archiveFiles = this.getFilesInDirectory('src/commands/archive');
    const brokenImports: string[] = [];

    for (const file of archiveFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('../utils') || content.includes('../db')) {
        brokenImports.push(path.relative(process.cwd(), file));
      }
    }

    this.results.push({
      category: '📦 Imports',
      status: brokenImports.length > 0 ? 'fail' : 'pass',
      message: brokenImports.length > 0
        ? `${brokenImports.length} files with incorrect import paths`
        : 'All import paths are correct',
      details: brokenImports
    });
  }

  private async checkErrorHandling(): Promise<void> {
    const files = this.getAllTypeScriptFiles();
    const issues: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');

      // Check for SQLITE references (should be PostgreSQL)
      if (content.includes('SQLITE_')) {
        issues.push(`${path.relative(process.cwd(), file)}: Contains SQLite error codes`);
      }

      // Check for catch blocks without proper error handling
      if (content.includes('catch {')) {
        issues.push(`${path.relative(process.cwd(), file)}: Empty catch block`);
      }

      // Check for any type in catch blocks
      if (content.includes('catch (error: any)')) {
        issues.push(`${path.relative(process.cwd(), file)}: Using 'any' type in catch block`);
      }
    }

    this.results.push({
      category: '⚠️ Error Handling',
      status: issues.length > 0 ? 'warning' : 'pass',
      message: issues.length > 0
        ? `Found ${issues.length} error handling issues`
        : 'Error handling looks good',
      details: issues.slice(0, 5)
    });
  }

  private async checkTODOs(): Promise<void> {
    const files = this.getAllTypeScriptFiles();
    const todos: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        if (line.includes('TODO') || line.includes('FIXME') || line.includes('HACK')) {
          todos.push(`${path.relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    this.results.push({
      category: '📝 TODOs',
      status: todos.length > 10 ? 'warning' : 'pass',
      message: `Found ${todos.length} TODO/FIXME comments`,
      details: todos.slice(0, 5)
    });
  }

  private async checkDependencies(): Promise<void> {
    try {
      const output = execSync('npm outdated --json', { stdio: 'pipe' }).toString();
      const outdated = JSON.parse(output || '{}');
      const count = Object.keys(outdated).length;

      this.results.push({
        category: '📚 Dependencies',
        status: count > 10 ? 'warning' : 'pass',
        message: `${count} outdated dependencies`,
        details: count > 0 ? Object.keys(outdated).slice(0, 5) : undefined
      });
    } catch (error) {
      // npm outdated returns non-zero exit code when there are outdated packages
      this.results.push({
        category: '📚 Dependencies',
        status: 'pass',
        message: 'All dependencies up to date'
      });
    }
  }

  private async checkSecurityPatterns(): Promise<void> {
    const files = this.getAllTypeScriptFiles();
    const issues: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(process.cwd(), file);

      // Check for console.log in production code
      if (!file.includes('test') && content.includes('console.log')) {
        issues.push(`${relativePath}: Contains console.log`);
      }

      // Check for hardcoded secrets
      if (content.match(/['"](sk_|pk_|secret_|key_|token_|password_)[a-zA-Z0-9]{20,}['"]/)) {
        issues.push(`${relativePath}: Possible hardcoded secret`);
      }

      // Check for eval usage
      if (content.includes('eval(')) {
        issues.push(`${relativePath}: Uses eval()`);
      }

      // Check for parseFloat for money
      if (file.includes('commands') && content.includes('parseFloat') && !content.includes('Money')) {
        issues.push(`${relativePath}: Uses parseFloat for money calculations`);
      }
    }

    this.results.push({
      category: '🛡️ Security',
      status: issues.length > 0 ? 'fail' : 'pass',
      message: issues.length > 0
        ? `Found ${issues.length} security issues`
        : 'No security issues detected',
      details: issues.slice(0, 5)
    });
  }

  private getAllTypeScriptFiles(): string[] {
    const srcDir = path.join(process.cwd(), 'src');
    return this.getFilesInDirectory(srcDir).filter(f => f.endsWith('.ts'));
  }

  private getFilesInDirectory(dir: string): string[] {
    const files: string[] = [];

    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory() && !item.includes('node_modules')) {
        files.push(...this.getFilesInDirectory(fullPath));
      } else if (stat.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private printReport(): void {
    console.log('\n' + '='.repeat(60));
    console.log(' 📊 HEALTH CHECK REPORT');
    console.log('='.repeat(60) + '\n');

    const passed = this.results.filter(r => r.status === 'pass').length;
    const failed = this.results.filter(r => r.status === 'fail').length;
    const warnings = this.results.filter(r => r.status === 'warning').length;

    for (const result of this.results) {
      const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
      console.log(`${icon} ${result.category}: ${result.message}`);

      if (result.details && result.details.length > 0) {
        for (const detail of result.details) {
          console.log(`   └─ ${detail}`);
        }
      }
      console.log('');
    }

    console.log('='.repeat(60));
    console.log(` SUMMARY: ${passed} passed, ${failed} failed, ${warnings} warnings`);
    console.log('='.repeat(60) + '\n');

    if (failed > 0) {
      console.log('❌ Critical issues found. Please fix before deploying.\n');
      process.exit(1);
    } else if (warnings > 0) {
      console.log('⚠️  Some warnings found. Consider addressing them.\n');
      process.exit(0);
    } else {
      console.log('✅ All checks passed! Codebase is healthy.\n');
      process.exit(0);
    }
  }
}

// Run the health check
if (require.main === module) {
  const healthCheck = new CodebaseHealthCheck();
  healthCheck.runAllChecks().catch(console.error);
}