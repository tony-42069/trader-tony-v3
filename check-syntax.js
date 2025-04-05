// Script to systematically check syntax of .js files in src/
const fs = require('fs');
const path = require('path');

// Store results
const results = {
  passed: [],
  failed: []
};

function checkFileSyntax(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);
  try {
    // Use require to trigger Node.js parsing
    require(filePath);
    console.log(`✓ ${relativePath} - OK`);
    results.passed.push(relativePath);
  } catch (error) {
    // Only report syntax errors, ignore others like module not found for now
    if (error instanceof SyntaxError) {
       console.error(`✗ ${relativePath} - SYNTAX ERROR: ${error.message}`);
       results.failed.push({ file: relativePath, error: error.message });
    } else {
       // Log other errors differently, might indicate dependency issues
       console.warn(`? ${relativePath} - Non-syntax error: ${error.message}`);
    }
  }
}

function scanDirectory(directory) {
  try {
    const files = fs.readdirSync(directory);
    
    for (const file of files) {
      const fullPath = path.join(directory, file);
      try {
        const stats = fs.statSync(fullPath);
        
        if (stats.isDirectory()) {
          // Recursively scan subdirectories, avoid node_modules
          if (path.basename(fullPath) !== 'node_modules') {
             scanDirectory(fullPath);
          }
        } else if (file.endsWith('.js')) {
          checkFileSyntax(fullPath);
        }
      } catch (statError) {
         console.error(`! Error stating file ${fullPath}: ${statError.message}`);
      }
    }
  } catch (readDirError) {
     console.error(`! Error reading directory ${directory}: ${readDirError.message}`);
  }
}

console.log("--- Starting Syntax Check ---");
// Start scanning from src directory
const srcDir = path.join(process.cwd(), 'src');
scanDirectory(srcDir);

console.log("\n--- Syntax Check Complete ---");
if (results.failed.length > 0) {
  console.error(`\nFound syntax errors in ${results.failed.length} file(s):`);
  results.failed.forEach(item => console.error(`  - ${item.file}: ${item.error}`));
} else {
  console.log("\nNo syntax errors found in src/**/*.js files.");
}
console.log(`Checked ${results.passed.length + results.failed.length} files.`);
