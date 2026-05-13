const bcrypt = require('bcryptjs');

const passwordHash = '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu';

// Test common passwords
const testPasswords = [
  'password123',
  'admin123',
  'password',
  'admin',
  'madison88',
  'sarah123',
  'superadmin123'
];

console.log('Testing passwords against hash:');
console.log('Hash:', passwordHash);
console.log('');

testPasswords.forEach(pwd => {
  const match = bcrypt.compareSync(pwd, passwordHash);
  console.log(`${pwd}: ${match ? '✅ MATCH' : '❌ NO MATCH'}`);
});

// If none match, generate a new hash for password123
console.log('\nGenerating new hash for "password123":');
const newHash = bcrypt.hashSync('password123', 10);
console.log('New hash:', newHash);
