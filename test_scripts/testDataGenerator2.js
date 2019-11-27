const fs = require('fs');
const path = require('path');
const helper = require('../helpers/helper');
const dir = '../test_data';

const generate = async function (a, b) {
    let p3 = '.json';
    let low = String(a);
    let k = 0;
    let all = [];
    for (let i = a; i < b; i++) {
        for (let j = 0; j < 1; j++) {
            let A = helper.getRandomInt(1001, 2000);
            let B = helper.getRandomInt(1001, 2000);
            let C = helper.getRandomInt(1001, 2000);
            let D = helper.getRandomInt(1001, 2000);
            let newObj = { pk: i, A: A, B: B, C: C, D: D };
            all.push(newObj);
            k++;
        }
    }
    await fs.writeFile('./test_data/' + low + p3, JSON.stringify(all), function (err) {
        if (err) {
            return console.log(err);
        }
    });
    return low + p3;
};
module.exports = { generate };