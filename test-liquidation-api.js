// Test Liquidation API Workflow
// This script tests the new liquidation workflow using API calls

const API_BASE = 'https://m88-bms.onrender.com/api';

// Test data - UPDATE WITH CORRECT CREDENTIALS
const TEST_EMAIL = 'your-email@example.com';
const TEST_PASSWORD = 'your-password';

let authToken = '';
let userId = '';
let testRequestId = '';
let testCashAdvanceId = '';

// Helper function to make API calls
async function apiCall(endpoint, method = 'GET', body = null, token = null) {
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const options = {
    method,
    headers
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    return { status: 500, data: { error: error.message } };
  }
}

// Step 1: Login
async function testLogin() {
  console.log('\n=== Step 1: Login ===');
  const result = await apiCall('/auth/login', 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD
  });
  
  if (result.status === 200 && result.data.token) {
    authToken = result.data.token;
    userId = result.data.user.id;
    console.log('✓ Login successful');
    console.log(`  User ID: ${userId}`);
    console.log(`  Role: ${result.data.user.role}`);
    return true;
  } else {
    console.log('✗ Login failed:', result.data);
    return false;
  }
}

// Step 2: Get user's cash advances
async function testGetCashAdvances() {
  console.log('\n=== Step 2: Get Cash Advances ===');
  const result = await apiCall('/cash-advances', 'GET', null, authToken);
  
  if (result.status === 200 && result.data) {
    console.log('✓ Cash advances fetched');
    console.log(`  Total cash advances: ${result.data.length}`);
    
    // Find an outstanding or partially liquidated cash advance
    const availableCashAdvance = result.data.find(ca => 
      ca.status === 'outstanding' || ca.status === 'partially_liquidated'
    );
    
    if (availableCashAdvance) {
      testCashAdvanceId = availableCashAdvance.id;
      console.log(`  Selected cash advance: ${availableCashAdvance.advance_code}`);
      console.log(`  Balance: ${availableCashAdvance.balance}`);
      console.log(`  Status: ${availableCashAdvance.status}`);
    } else {
      console.log('  No available cash advances for testing');
    }
    
    return true;
  } else {
    console.log('✗ Failed to fetch cash advances:', result.data);
    return false;
  }
}

// Step 3: Get user's requests
async function testGetRequests() {
  console.log('\n=== Step 3: Get Requests ===');
  const result = await apiCall('/requests/my', 'GET', null, authToken);
  
  if (result.status === 200 && result.data) {
    console.log('✓ Requests fetched');
    console.log(`  Total requests: ${result.data.length}`);
    
    // Find a released request
    const releasedRequest = result.data.find(req => req.status === 'released');
    
    if (releasedRequest) {
      testRequestId = releasedRequest.id;
      console.log(`  Selected request: ${releasedRequest.request_code}`);
      console.log(`  Status: ${releasedRequest.status}`);
      console.log(`  Amount: ${releasedRequest.amount}`);
    } else {
      console.log('  No released requests found for testing');
    }
    
    return true;
  } else {
    console.log('✗ Failed to fetch requests:', result.data);
    return false;
  }
}

// Step 4: Test liquidation submission
async function testLiquidationSubmission() {
  console.log('\n=== Step 4: Test Liquidation Submission ===');
  
  if (!testRequestId) {
    console.log('✗ No test request available');
    return false;
  }
  
  if (!testCashAdvanceId) {
    console.log('✗ No test cash advance available');
    return false;
  }
  
  const result = await apiCall(`/requests/${testRequestId}/liquidation`, 'PATCH', {
    cash_advance_id: testCashAdvanceId,
    amount_spent: 1000,
    remarks: 'Test liquidation via API',
    attachments: []
  }, authToken);
  
  if (result.status === 200) {
    console.log('✓ Liquidation submitted successfully');
    console.log(`  Liquidation ID: ${result.data.id}`);
    console.log(`  Cash Advance ID: ${result.data.cash_advance_id}`);
    console.log(`  Amount Spent: ${result.data.amount_spent}`);
    return true;
  } else {
    console.log('✗ Liquidation submission failed:', result.data);
    return false;
  }
}

// Step 5: Verify cash advance balance updated
async function testCashAdvanceBalance() {
  console.log('\n=== Step 5: Verify Cash Advance Balance ===');
  
  if (!testCashAdvanceId) {
    console.log('✗ No test cash advance available');
    return false;
  }
  
  const result = await apiCall(`/cash-advances/${testCashAdvanceId}`, 'GET', null, authToken);
  
  if (result.status === 200 && result.data) {
    console.log('✓ Cash advance details fetched');
    console.log(`  Current Balance: ${result.data.balance}`);
    console.log(`  Status: ${result.data.status}`);
    console.log(`  Amount Liquidated: ${result.data.amount_liquidated}`);
    return true;
  } else {
    console.log('✗ Failed to fetch cash advance details:', result.data);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('=== Testing Liquidation API Workflow ===');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Test User: ${TEST_EMAIL}`);
  
  const loginSuccess = await testLogin();
  if (!loginSuccess) {
    console.log('\n✗ Tests failed: Login unsuccessful');
    return;
  }
  
  await testGetCashAdvances();
  await testGetRequests();
  
  if (testRequestId && testCashAdvanceId) {
    await testLiquidationSubmission();
    await testCashAdvanceBalance();
  } else {
    console.log('\n⚠ Skipping liquidation tests: No suitable test data available');
  }
  
  console.log('\n=== Test Complete ===');
}

// Run the tests
runTests().catch(error => {
  console.error('Test error:', error);
});
