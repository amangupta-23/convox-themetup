// website.js (fixed with ES module syntax)
import http from 'node:http';
import fs from 'node:fs';

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  console.log(req.url);

  if (req.url === '/') {
    res.statusCode = 200;
    res.end('<h1>This is Mohit</h1><p>Hey this is the way to rule the world</p>');
  } 
  else if (req.url === '/about') {
    res.statusCode = 200;
    res.end('<h1>About Mohit</h1><p>Hey this is about the legend!</p>');
  } 
  else if (req.url === '/hello') {
    res.statusCode = 200;
    const data = fs.readFileSync('index.html');
    res.end(data.toString());
  } 
  else {
    res.statusCode = 404;
    res.end('<h1>Page Not Found</h1><p>Hey, this page was not found on this server</p>');
  }
});

server.listen(port, () => {
  console.log(`Server is running at ${port}`);
});
