import { EventEmitter } from 'events';

class MyEmitter extends EventEmitter {}

const myEmitter = new MyEmitter();

myEmitter.on('I love gym', () => {
    console.log('make me rich to build it');
    setTimeout(() => {
        console.log('make me rich! Its gentle reminder');
    }, 5000);
});

console.log("The script is running")
console.log("The script is still running")
myEmitter.emit('I love gym');