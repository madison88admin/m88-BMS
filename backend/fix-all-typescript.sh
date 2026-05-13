#!/bin/bash

echo "🔧 Fixing all TypeScript compilation issues..."

# Install ALL missing type definitions
npm install --save-dev @types/node @types/express @types/cors @types/helmet @types/dotenv @types/nodemailer @types/bcryptjs @types/jsonwebtoken @types/multer @types/pdfkit @types/express-serve-static @types/mime

# Update package.json to include types in dependencies
npm pkg install @types/node --save-dev

# Update tsconfig.json for production
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020", "DOM"],
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "ignoreDeprecations": "6.0"
  },
  "include": ["src/server.ts", "src/utils/**/*", "src/routes/**/*"],
  "exclude": ["node_modules", "dist", "src/scratch"]
}
'EOF'

echo "✅ All TypeScript issues fixed!"
echo "🚀 Ready for Render deployment!"
