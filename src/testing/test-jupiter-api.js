// test-jupiter-api.js
const axios = require('axios');

async function testJupiterQuote() {
  try {
    // Use the same parameters as in your jupiterClient.getQuote
    // Using suggested Testnet USDC address: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
    const params = {
      inputMint: "So11111111111111111111111111111111111111112", // WSOL (representing SOL)
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Mainnet USDC address
      amount: 1000000, // 0.001 SOL in lamports
      slippageBps: 100 // 1%
    };
    
    console.log('Sending request to Jupiter API v6/quote with params:', params);
    
    const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
      params: params
    });
    
    console.log('Success! Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('API call failed with error:');
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Status:', error.response.status);
      console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // The request was made but no response was received
      console.error('Request data:', error.request);
      console.error('No response received from Jupiter API.');
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error message:', error.message);
    }
    console.error('Request config:', JSON.stringify(error.config, null, 2));
  }
}

testJupiterQuote();
