import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { supabase } from './src/utils/supabase';

const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;
const getPasswordResetSecret = () => process.env.JWT_SECRET || 'change-me';
const getPasswordResetTokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

async function testPasswordReset() {
  console.log('=== Testing Password Reset ===\n');
  
  // Get a test user from your DB
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, name')
    .limit(1)
    .single();
    
  if (userError || !user) {
    console.error('❌ Error getting test user:', userError);
    return;
  }
  console.log('✅ Got test user:', user.email, user.name, user.id);
  
  // Step 1: Create a password reset token
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  const { data: createdResetToken, error: insertError } = await supabase
    .from('password_reset_tokens')
    .insert({
      user_id: user.id,
      token_hash: 'pending',
      expires_at: expiresAt,
      last_sent_at: new Date().toISOString()
    })
    .select('id, user_id, expires_at')
    .single();
    
  if (insertError || !createdResetToken) {
    console.error('❌ Error creating reset token:', insertError);
    return;
  }
  console.log('✅ Created reset token in DB:', createdResetToken);
  
  // Step 2: Build the JWT token
  const buildPasswordResetToken = (resetToken: any) => {
    const exp = Math.floor(Date.now() / 1000) + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60;
    const token = jwt.sign(
      {
        sub: resetToken.user_id,
        jti: resetToken.id,
        type: 'password_reset',
        exp
      },
      getPasswordResetSecret(),
      { algorithm: 'HS256' }
    );
    console.log('✅ Built JWT token, exp:', exp);
    return token;
  };
  
  const rawToken = buildPasswordResetToken(createdResetToken);
  console.log('✅ Generated raw token:', rawToken);
  
  // Step3: Calculate token hash and update DB
  const tokenHash = getPasswordResetTokenHash(rawToken);
  console.log('✅ Calculated token hash:', tokenHash);
  
  const { error: updateError } = await supabase
    .from('password_reset_tokens')
    .update({ token_hash })
    .eq('id', createdResetToken.id);
    
  if (updateError) {
    console.error('❌ Error updating token hash:', updateError);
    return;
  }
  console.log('✅ Updated token hash in DB');
  
  // Step4: Verify everything!
  console.log('\n=== Verifying Token ===');
  const tokenHashVerify = getPasswordResetTokenHash(rawToken);
  console.log('✅ Token hash for verification:', tokenHashVerify);
  console.log('✅ Token hash matches:', tokenHash === tokenHashVerify);
  
  let decoded;
  try {
    decoded = jwt.verify(rawToken, getPasswordResetSecret());
    console.log('✅ Successfully decoded token:', decoded);
  } catch (e) {
    console.error('❌ Failed to decode token:', e);
    return;
  }
  
  // Step5: Get token from DB and check
  const { data: tokenFromDb, error: fetchError } = await supabase
    .from('password_reset_tokens')
    .select('*')
    .eq('id', createdResetToken.id)
    .single();
    
  if (fetchError || !tokenFromDb) {
    console.error('❌ Error fetching token from DB:', fetchError);
    return;
  }
  console.log('\n✅ Token from DB token_hash:', tokenFromDb.token_hash);
  console.log('✅ DB token_hash matches our calculated hash:', tokenFromDb.token_hash === tokenHashVerify);
  
  // Step6: Check user_id match
  console.log('✅ token.sub (decoded user_id):', decoded.sub);
  console.log('✅ token.user_id (from DB):', tokenFromDb.user_id);
  console.log('✅ User ID matches:', tokenFromDb.user_id === decoded.sub);
  
  // Step7: Check token type
  console.log('✅ token.type:', decoded.type);
  console.log('✅ Type is password_reset:', decoded.type === 'password_reset');
  
  console.log('\n✅ All checks passed! Token is valid!');
  
  console.log('\n=== Testing with API Endpoint ===');
  console.log('Token to use:', rawToken);
  console.log('\nYou can manually test using curl:');
  console.log('curl -X POST http://localhost:5000/api/auth/reset-password \\');
  console.log('  -H "Content-Type: application/json" \\');
  console.log(`  -d '{"token":"${rawToken}","password":"Test1234"}'`);
}

testPasswordReset().catch(console.error);