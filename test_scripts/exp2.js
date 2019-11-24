const fs =require('fs');
const request =require('request');
path = require('path');
let numberofFacts = 100;
let fileToSaveTestData = 'testData_';
const helper = require('../helpers/helper');
const filename = './queriesEXP1.txt';
const generator = require('./testDataGenerator2');
const dir = '../test_data/';
const dreq = '100dir';
const Promise = require('promise');
const ResultsFile = "resultsEXP1_100A.txt";
const rp = require('request-promise');


const load =  (file) => {
    let read = Promise.denodeify(fs.readFile);
    return read(path.resolve(__dirname, file), 'utf8');
};

load_files = (directory, valid, error) => {
    return new Promise((resolve, reject)=> {
        let result = '';
        fs.readdir(path.resolve(__dirname, directory),function(error, items){
            if (error) {
                return console.log(error)
            } else {
                console.log(items);
                let filtered = items.filter(el => valid.includes(el));
                let list_files = filtered.toString();
                items = list_files.split(',');
                result = items;
                resolve(result);
            }
        });
    });
};

const load_data = async (fileno, queries) => {
    return new Promise((resolve, reject) => {
        let file = fileno;

        let url = 'http://localhost:3000/load_dataset/' + fileno;
        let urlGB='http://localhost:3000/getViewByName/' +queries+ '(COUNT)/'+'ABCD';
        console.log(queries[0]);
        console.log('urlGB: '+urlGB);
        console.log("url: "+url);
        let t = 12000*60*10;

        let options = {
            uri: url,
            timeout: t,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko)Chrome/38.0.2125.111 Safari/537.36','Connection': 'keep-alive'},
            json: true // Automatically parses the JSON string in the response
        };

        let options2 = {
            timeout:t,
            uri: urlGB,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko)Chrome/38.0.2125.111 Safari/537.36','Connection': 'keep-alive'},
            json: true // Automatically parses the JSON string in the response
        };

        rp(options)
            .then(function () {
                rp(options2)
                    .then((res) => handleResponse(res).then(
                        ()=>{
                            resolve()
                        }
                    ))
                    .catch(function (err) {
                        console.log(err);
                        reject(err);
                    });
            })
            .catch(function (err) {
                console.log(err);
                reject(err);
            });
    });
};

handleResponse = async(body) => {
    return new Promise((resolve, reject) => {
     //   console.log(JSON.stringify(body));
        let f = body.toString().substr(String(body).indexOf('operation').toString());
        console.log(f);
        let JSONresp = JSON.parse(('{"'+f).toString());
        writeToFile(JSON.stringify(JSONresp),ResultsFile).then(()=>{
            console.log(JSONresp);
            resolve()
        });
    });
};

const writeToFile = async(data, filepath) => {
    return new Promise((resolve, reject) => {
        let write = Promise.denodeify(fs.appendFile);
        const res = String(data+',\n');
        console.log("result: " + res);
        let writeFile = write(filepath, res);
        resolve(writeFile);
    });
};

const saveFile = (dataToWrite, outComeFilePath) => {
    writeToFile(dataToWrite, outComeFilePath)
    .then(()=>console.log ("file"+outComeFilePath + "saved successfully"))
    .catch((err)=> console.log(err));
};

const jparse = function(filename, error) {
    fs.readFile(filename, function read(err, data) {
        if (err) {
            throw err;
        }
        let res = data;
        res = '['+String(res)+']';

        res = res.replace('},]','}]');
        let j_file = JSON.parse(res);

        let blockchain_array = [];
        let cache_retrieve_array = [];
        let cache_save_array = [];
        let total_array = [];
        let all_total_array = [];
        let sql_array = [];

        for(let i = 0; i < j_file.length; i++){
            let jObject = j_file[i];
            blockchain_array.push(jObject.bcTime);
            cache_retrieve_array.push(jObject.cacheRetrieveTime);
            cache_save_array.push(jObject.cacheSaveTime);
            sql_array.push(jObject.sqlTime);
            total_array.push(jObject.totalTime);
        }

        for(let i = 0;i < total_array.length; i++){
            console.log("i: "+i+" "+total_array[i]);
        }
    });
};



main = async() => {
    //jparse(ResultsFile);
    load(filename)
        .then(async(res)=> {
            let fns = [];
            const queries = res.split(',');
            for(let i = 1; i <= 100; i++) {
               let crnFN =  await generator.generate(100*(i-1),100*i);
               fns.push(crnFN);
                // return array with filenames, then filter the ones read from the directory
            }
            load_files(dir, fns)
                .then(async(files) => {
                    //console.log(queries)
                    //fileToArray => queries
                    //fileNames
                    for(let i = 0; i < queries.length; i++){
                        await load_data(files[i],queries[i]).then(()=>{
                            console.log("file " + i +" loaded");
                        });
                    }
                });
        })
        .catch((err)=> {
            console.log(err);
        })

};
main();


