const fs = require('fs');
const path = require('path');

const srcDir = 'C:\\Users\\hasit\\projects\\freellm\\src';

// Mapping of arbitrary font sizes to Tailwind classes
const replacements = [
  // 10px -> text-2xs
  { pattern: /text-\[10px\]/g, replacement: 'text-2xs' },
  // 11px -> text-xs  
  { pattern: /text-\[11px\]/g, replacement: 'text-xs' },
  // 12px -> text-xs (0.75rem = 12px, close enough to 0.6875rem)
  { pattern: /text-\[12px\]/g, replacement: 'text-xs' },
  // 13px -> text-sm
  { pattern: /text-\[13px\]/g, replacement: 'text-sm' },
  // 14px -> text-sm (since base is 16px)
  { pattern: /text-\[14px\]/g, replacement: 'text-sm' },
  // 15px -> text-base
  { pattern: /text-\[15px\]/g, replacement: 'text-base' },
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  for (const { pattern, replacement } of replacements) {
    const newContent = content.replace(pattern, replacement);
    if (newContent !== content) {
      modified = true;
      content = newContent;
    }
  }
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath);
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      processFile(fullPath);
    }
  }
}

walkDir(srcDir);
console.log('Done!');