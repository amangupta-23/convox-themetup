import express from 'express';

const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('PD group Real estate!');
});

app.get('/about', (req, res) => {
  res.send('This is about a page!');
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
