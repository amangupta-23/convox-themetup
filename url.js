import { URL } from 'url';


const myURL = new URL('http://example.org:5555');
myURL.pathname = '/a/b/c';
myURL.search = '?d=e';
myURL.hash = '#fgh';

console.log(myURL)
console.log(myURL.href)