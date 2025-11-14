const http = require('http');

let userCallCount = 0;
let productCallCount = 0;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'GET' && req.url === '/api/v1/users') {
    userCallCount++;
    let response;
    
    if (userCallCount % 3 === 0) {
      // Missing 'email' field
      response = {
        id: 1,
        name: "John Doe",
        age: 30
      };
    } else if (userCallCount % 3 === 1) {
      // Has all fields + extra 'address', type change on age
      response = {
        id: 2,
        name: "Jane Smith",
        email: "jane@example.com",
        age: "25",
        address: "123 Main St"
      };
    } else {
      // Base shape
      response = {
        id: 3,
        name: "Bob Johnson",
        email: "bob@example.com",
        age: 35
      };
    }
    
    res.writeHead(200);
    res.end(JSON.stringify(response));
  } 
  else if (req.method === 'GET' && req.url === '/api/v1/products') {
    productCallCount++;
    
    const response = {
      id: productCallCount,
      name: `Product ${productCallCount}`,
      price: 99.99,
      inStock: true
    };
    
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }
  else if (req.method === 'POST' && req.url === '/api/v1/orders') {
    const random = Math.random();
    let response;
    
    if (random < 0.33) {
      // Missing 'shippingAddress'
      response = {
        orderId: "ORD-001",
        items: [{ id: 1, qty: 2 }],
        total: 199.98
      };
    } else if (random < 0.66) {
      // Type change: total as string
      response = {
        orderId: "ORD-002",
        items: [{ id: 2, qty: 1 }],
        total: "99.99",
        shippingAddress: "456 Oak Ave"
      };
    } else {
      // Base shape
      response = {
        orderId: "ORD-003",
        items: [{ id: 3, qty: 5 }],
        total: 499.95,
        shippingAddress: "789 Pine Rd"
      };
    }
    
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }
  else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Mock backend running on http://localhost:${PORT}`);
  console.log('Endpoints with varying shapes:');
  console.log('  GET  /api/v1/users   (missing fields, type changes)');
  console.log('  POST /api/v1/orders  (missing fields, type changes)');
  console.log('Endpoint with consistent shape:');
  console.log('  GET  /api/v1/products');
});
