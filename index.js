const express = require('express');
const bodyParser = require('body-parser');
const solc = require('solc');
const fs = require('fs');
const delay = require('delay');
const groupBy = require('group-by');
const dataset = require('./dataset_1k');
let fact_tbl = require('./templates/fact_tbl');
const crypto = require('crypto');
let md5sum = crypto.createHash('md5');
const csv = require('fast-csv');
abiDecoder = require('abi-decoder');
const app = express();
const jsonParser = bodyParser.json();
const helper = require('./helper');
const contractGenerator = require('./contractGenerator');
const transformations = require('./transformations');
app.use(jsonParser);
let running = false;
let gbRunning = false;
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.static('public'));
const microtime = require('microtime');
let http = require('http').Server(app);
let io = require('socket.io')(http);
const csvtojson = require('csvtojson');
const jsonSql = require('json-sql')({separatedValues: false});

const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));
const redis = require('redis');
const client = redis.createClient(6379, '127.0.0.1');
client.on('connect', function () {
    console.log('Redis client connected');
});
client.on('error', function (err) {
    console.log('Something went wrong ' + err);
});

const mysql = require('mysql');
let createTable = '';
let tableName = '';
let connection = null;
let contractInstance = null;
let contractsDeployed = [];

web3.eth.defaultAccount = web3.eth.accounts[0];
let contract = null;
let DataHandler = null;
let acc = null;
app.get('/', function (req, res) {
    fs.readdir('./templates', function (err, items) {
        res.render('index', { 'templates': items });
    })
});

io.on('connection', function (socket) {
    console.log('a user connected');
});

app.get('/dashboard', function (req, res) {
    fs.readdir('./templates', function (err, items) {
        web3.eth.getBlockNumber().then(blockNum => {
            res.render('dashboard', { 'templates': items, 'blockNum': blockNum });
        });
    });
});

app.get('/benchmark', function (req, res) {
    // var stream = fs.createReadStream('../dataset.csv');
    csvtojson({ delimiter: '|' })
        .fromFile('../dataset.csv')
        .then((jsonObj)=>{
            console.log(jsonObj);
            let timeStart = microtime.nowDouble();
            let gbResult = groupBy(jsonObj,'Occupation');
            console.log(microtime.nowDouble() - timeStart + ' seconds');
            res.send(gbResult);
        });
});

app.get('/form/:contract', function (req, res) {
    let fact_tbl = require('./templates/' + req.params.contract);
    let templ = {};
    if ('template' in fact_tbl) {
        templ = fact_tbl['template'];
    } else {
        templ = fact_tbl;
    }
    let address = '0';
    for (let i = 0; i < contractsDeployed.length; i++) {
        if (contractsDeployed[i].contractName === fact_tbl.name) {
            address = contractsDeployed[i].address;
            break;
        }
    }
    let fbsField = fact_tbl.groupBys.TOP.children;

    let groupBys = helper.flatten(fbsField);
    groupBys = groupBys.map(function (obj) {
        return obj.fields;
    });
    let readyViews = fact_tbl.views;
    readyViews = readyViews.map(x => x.name);
    groupBys = helper.removeDuplicates(groupBys);
    groupBys.push(fact_tbl.groupBys.TOP.fields);
    console.log(groupBys);
    res.render('form',{'template':templ, 'name': fact_tbl.name, 'address': address, 'groupBys':groupBys, 'readyViews': readyViews});
});

http.listen(3000, () => {
    console.log(`Example app listening on http://localhost:3000/dashboard`);
    let mysqlConfig = {};
    if(process.env.NODE_ENV === 'development'){
        mysqlConfig = {
            host: 'localhost',
            user: 'root',
            password: 'Xonelgataandrou1!',
            database: 'Ptychiaki'
        };
    } else if(process.env.NODE_ENV === 'lab'){
        mysqlConfig = {
            host: 'localhost',
            user: 'root',
            password: 'Iwanttobelive1',
            database: 'Ptychiaki'
        };
    }
    connection = mysql.createConnection(mysqlConfig);
    connection.connect(function (err) {
        if (err) {
            console.error('error connecting to mySQL: ' + err.stack);
            return;
        }
        console.log('mySQL connected');
    });
});

async function deploy(account, contractPath) {
    const input = fs.readFileSync(contractPath);
    const output = solc.compile(input.toString(), 1);
    console.log(output);
    const bytecode = output.contracts[Object.keys(output.contracts)[0]].bytecode;
    const abi = JSON.parse(output.contracts[Object.keys(output.contracts)[0]].interface);

    contract = new web3.eth.Contract(abi);
    let contractInstance =  await contract.deploy({data: '0x' + bytecode})
        .send({
            from: account,
            gas: 150000000,
            gasPrice: '30000000000000'
        }, (err, txHash) => {
            console.log('send:', err, txHash);
        })
        .on('error', (err) => {
            console.log('error:', err);
        })
        .on('transactionHash', (err) => {
            console.log('transactionHash:', err);
        })
        .on('receipt', (receipt) => {
            console.log('receipt:', receipt);
            contract.options.address = receipt.contractAddress;
            contractsDeployed.push({contractName: Object.keys(output.contracts)[0].slice(1), address: receipt.contractAddress});
            console.log(contractsDeployed);
        });
    return contractInstance.options;
}

app.get('/readFromFile', function (req, res) {
    csv
        .fromPath('dataset.txt',{delimiter: '|'})
        .on('data', function (data) {
            console.log(data);
        })
        .on('end', function () {
            console.log('done');
            res.send('done');
        })
});

app.get('/deployContract/:fn', function (req, res) {
    web3.eth.getAccounts(function (err, accounts) {
        if (!err) {
            acc = accounts[1];
            console.log(req.params.fn);
            deploy(accounts[0], './contracts/' + req.params.fn)
                .then(options => {
                    console.log('Success');
                    res.send({status:'OK', options: options});
                })
                .catch(err => {
                    console.log('error on deploy ' + err);
                    res.status(400);
                    res.send({status:'ERROR', options: 'Deployment failed'});
                })
        }
    });
});

async function addManyFactsNew(facts, sliceSize) {
    console.log('length = ' + facts.length);
    const transactionObject = {
        from: acc,
        gas: 1500000000000,
        gasPrice: '30000000000000'
    };
    let proms = [];
    let allSlicesReady = [];
    if(sliceSize > 1) {
        let slices = [];
        let slicesNum = Math.ceil(facts.length / sliceSize);
        console.log("*will add " + slicesNum + " slices*");

        for (let j = 0; j < slicesNum; j++) {
            if (j === 0) {
                slices[j] = facts.filter((fct, idx) => idx < sliceSize);
            } else {
                slices[j] = facts.filter((fct, idx) => idx > j * sliceSize && idx < (j + 1) * sliceSize);
            }
        }

        allSlicesReady = slices.map(slc => {
            return slc.map(fct => {
                return JSON.stringify(fct);
            });
        });
        // for (const slc of slices) {
        //     let crnProms = [];
        //     crnProms = slc.map(fct => {
        //         return JSON.stringify(fct);
        //     });
        //     allSlicesReady.push(crnProms);
        // }
    } else {
        allSlicesReady = facts.map(fact => {
            return [JSON.stringify(fact)];
        });
    }

    let i = 0;
    for(const slc of allSlicesReady){
        let transPromise = await contract.methods.addFacts(slc).send(transactionObject, (err, txHash) => {
        }).on('error', (err) => {
            console.log('error:', err);
        }).on('transactionHash', (hash) => {
            console.log(i);
            io.emit('progress', i/allSlicesReady.length);
        });
        i++;
    }

    // for (const fact of facts) {
    //     let strFact = JSON.stringify(fact);
    //     proms.push(strFact);
    //     console.log(strFact);
    // }
    // console.log("done loop");
    // console.log(proms.length);
    // let transPromise = await contract.methods.addFacts(proms).send(transactionObject, (err, txHash) => {
    // console.log(err);
    //     console.log(txHash);
    // }).on('error', (err) => {
    //     console.log('error:', err);
    // }).on('transactionHash', (hash) => {
    //     console.log("***");
    //     console.log(hash);
    //     console.log("***");
    // });
    return Promise.resolve(true);
}

async function addManyFacts(facts) {
    console.log('length = ' + facts.length);
    const transactionObject = {
        from: acc,
        gas: 1500000,
        gasPrice: '30000000000000'
    };
    let proms = [];
    let i = 0;
    for (const fact of facts) {
        let strFact = JSON.stringify(fact);
        let transPromise = await contract.methods.addFact(strFact).send(transactionObject, (err, txHash) => {
            //console.log('send:', err, txHash);
        }).on('error', (err) => {
            console.log('error:', err);
        }).on('transactionHash', (err) => {
                //console.log('transactionHash:', err);
                io.emit('progress', i/facts.length);
                console.log(i);
            });
            // .on('receipt', (receipt) => {
            //     // console.log('receipt:', receipt);
            //     io.emit('progress', i/facts.length);
            //     console.log(i);
            // }).
        i++;
    }
    // console.log('LOOP ENDED EXECUTING BATCH');
    // batch.execute();
    return Promise.resolve(true);
}

app.get('/load_dataset/:dt', function (req, res) {
    let dt = require('./' + req.params.dt);
    console.log("ENDPOINT HIT AGAIN");
    console.log(running);
    if (contract) {
        if (!running) {
            running = true;
            let startTime = microtime.nowDouble();
            addManyFactsNew(dt,10).then(retval => {
                let endTime = microtime.nowDouble();
                let timeDiff = endTime - startTime;
                running = false;
                io.emit("DONE","TRUE");
                console.log("Added " + dt.length + " records in " + timeDiff + " seconds");
                return res.send('DONE');
            }).catch(error => {
                console.log(error);
            })
        }
    } else {
        res.status(400);
        res.send({status: 'ERROR',options: 'Contract not deployed' });
    }
});

app.get('/new_contract/:fn', function (req, res) {
    contractGenerator.generateContract(req.params.fn).then(function(result){
        createTable = result.createTable;
        tableName = result.tableName;
        return res.send({ msg: 'OK', 'filename':result.filename + '.sol', 'template': result.template });
    } , function(err) {
        console.log(err);
        return res.send({ msg: 'error' });
    });
});

app.get('/getFactById/:id', function (req, res) {
    if (contract) {
        contract.methods.getFact(parseInt(req.params.id,10)).call(function (err, result) {
            if (!err) {
                let len = Object.keys(result).length;
                for (let j = 0; j < len / 2; j ++) {
                    delete result[j];
                }
                res.send(result);
            } else {
                console.log(err);
                console.log('ERRRRRR');
                res.send(err);
            }
        })
    } else {
        res.status(400);
        res.send({ status: 'ERROR', options: 'Contract not deployed' });
    }
});

app.get('/allFacts', function (req, res) {
    getAllFactsHeavy(50).then(retval => {
        res.send(retval);
    }).catch(error => {
        console.log(error);
    })
});

async function getAllFactsHeavy(factsLength) {
    let allFacts = [];
    await contract.methods.getAllFacts(factsLength).call(function (err, result) {
        if (!err) {
            let len  = Object.keys(result).length;
            for (let  j = 0; j < len / 2; j ++) {
                delete result[j];
            }
            if ('payloads' in result) {
                for (let i = 0; i < result['payloads'].length; i++) {
                    let crnLn = JSON.parse(result['payloads'][i]);
                    crnLn.timestamp =  result['timestamps'][i];
                    allFacts.push(crnLn);
                }
            }
        } else {
            console.log(err);
            console.log('ERRRRRR');
        }
    });
    return allFacts;
}

async function getAllFacts(factsLength) {
    let allFacts = [];
    for (let i = 0; i < factsLength; i++) {
        await contract.methods.facts(i).call(function (err, result2) {
            if (!err) {
                let len  = Object.keys(result2).length;
                for (let  j = 0; j < len / 2; j ++) {
                    delete result2[j];
                }
                if ('payload' in result2) {
                    let crnLn = JSON.parse(result2['payload']);
                    crnLn.timestamp = result2['timestamp'];
                    allFacts.push(crnLn);
                }
            } else {
                console.log(err);
                console.log('ERRRRRR');
            }
        })
    }
    return allFacts;
}

async function getFactsFromTo(from, to) {
    let allFacts = [];
        await contract.methods.getFactsFromTo(from, to).call(function (err, result) {
            if (!err) {
                let len  = Object.keys(result).length;
                for (let  j = 0; j < len / 2; j ++) {
                    delete result[j];
                }
                if ('payloadsFromTo' in result) {
                    for (let i = 0; i < result['payloadsFromTo'].length; i++) {
                        let crnLn = JSON.parse(result['payloadsFromTo'][i]);
                        crnLn.timestamp =  result['timestampsFromTo'][i];
                        allFacts.push(crnLn);
                    }
                }
            } else {
                console.log(err);
                console.log('ERRRRRR');
            }
        });
    return allFacts;
}

app.get('/getFactsFromTo/:from/:to', function (req,res) {
    let timeStart = microtime.nowDouble();
   getFactsFromTo(parseInt(req.params.from), parseInt(req.params.to)).then(retval => {
       let timeFinish = microtime.nowDouble() - timeStart;
           console.log(retval);
           retval.push({time: timeFinish});
           res.send(retval);
   }).catch(err =>{
       res.send(err);
   });
});

app.get('/getallfacts', function (req, res) {
    if (contract) {
        contract.methods.dataId().call(function (err, result) {
            console.log('********');
            console.log(result);
            console.log('*****');
            if (!err) {
                // async loop waiting to get all the facts separately
                let timeStart = microtime.nowDouble();
                getAllFactsHeavy(result).then(retval => {
                    let timeFinish = microtime.nowDouble() - timeStart;
                    console.log('####');
                    console.log('Get all facts time: ' + timeFinish + ' s');
                    console.log('####');
                    retval.push({time: timeFinish});
                    //retval.timeDone = microtime.nowDouble() - timeStart;
                    res.send(retval);
                }).catch(error => {
                    console.log(error);
                });
            } else {
                console.log(err);
                console.log('ERRRRRR');
                res.send(err);
            }
        })
    } else {
        res.status(400);
        res.send({status: 'ERROR',options: 'Contract not deployed' });
    }
});

app.get('/groupbyId/:id', function (req, res) {
    if (contract) {
        contract.methods.getGroupBy(parseInt(req.params.id,10)).call(function (err, result) {
            if (!err) {
                res.send(result)
            } else {
                console.log(err);
                console.log('ERRRRRR');
                res.send(err);
            }
        })
    } else {
        res.status(400);
        res.send({status: 'ERROR',options: 'Contract not deployed' });
    }
});

app.post('/addFacts', function (req, res) {
    if (contract) {
        if (req.body.products.length === req.body.quantities.length === req.body.customers.length) {
            contract.methods.addFacts(req.body.products, req.body.quantities, req.body.customers).call(function (err, result) {
                if (!err) {
                    res.send(result)
                } else {
                    console.log(err);
                    console.log('ERRRRRR');
                    res.send(err);
                }
            })
        } else {
            res.status(400);
            res.send({status: 'ERROR',options: 'Arrays must have the same dimension' });
        }
    } else {
        res.status(400);
        res.send({status: 'ERROR',options: 'Contract not deployed' });
    }
});

function cost(groupBysArray) {
    for(let i = 0; i < groupBysArray.length; i++){
        let crnGroupBy = groupBysArray[i];
        let crnCost = (0.5 * crnGroupBy.columnSize) + (100000 / crnGroupBy.gbTimestamp);
        crnGroupBy.cost = crnCost;
        groupBysArray[i] = crnGroupBy;
    }
    return groupBysArray;
}

function containsAllFields(transformedArray, view) {
    for (let i = 0; i < transformedArray.length; i++) {
        let containsAllFields = true;
        let crnView = transformedArray[i];

        let cachedGBFields = JSON.parse(crnView.columns);
        console.log("###");
        for(let index in cachedGBFields.fields){
            cachedGBFields.fields[index] = cachedGBFields.fields[index].trim();
        }
        console.log(cachedGBFields);
        console.log("###");
        for (let j = 0; j < view.gbFields.length; j++) {
            console.log(view.gbFields[j]);
            if (!cachedGBFields.fields.includes(view.gbFields[j])) {
                containsAllFields = false
            }
        }
        transformedArray[i].containsAllFields = containsAllFields;
    }
    return transformedArray;
}

function saveOnCache(gbResult, operation, latestId){
    console.log("SAVE ON CACHE BEGUN");
    const transactionObject = {
        from: acc,
        gas: 15000000,
        gasPrice: '30000000000000'
    };
    md5sum = crypto.createHash('md5');
    md5sum.update(JSON.stringify(gbResult));
    let hash = md5sum.digest('hex');
    console.log(hash);
    console.log('**');
    console.log(JSON.stringify(gbResult));
    console.log('**');
    console.log(gbResult);
    let colSize = gbResult.groupByFields.length;
    let columns = JSON.stringify({fields: gbResult.groupByFields});
    client.set(hash, JSON.stringify(gbResult), redis.print);
   return contract.methods.addGroupBy(hash, Web3.utils.fromAscii(operation), latestId, colSize, columns).send(transactionObject);
}

function calculateNewGroupBy(facts, operation, gbFields, aggregationField, callback) {

    connection.query(createTable, function (error, results, fields) { //creating the SQL table for "Fact Table"
        if (error) throw error;
        let sql = jsonSql.build({
            type: 'insert',
            table: tableName,
            values: facts
        });

        let editedQuery = sql.query.replace(/"/g, '');
        editedQuery = editedQuery.replace(/''/g, 'null');
        console.log(editedQuery);
        connection.query(editedQuery, function (error, results2, fields) { //insert facts
            if (error) throw error;

            let gbQuery = null;
            if (operation === 'AVERAGE') {
                gbQuery = jsonSql.build({
                    type: 'select',
                    table: tableName,
                    group: gbFields,
                    fields: [gbFields,
                        {
                            func: {
                                name: 'SUM', args: [{field: aggregationField}]
                            }
                        },
                        {
                            func: {
                                name: 'COUNT', args: [{field: aggregationField}]
                            }
                        }]
                });
            } else {
                gbQuery = jsonSql.build({
                    type: 'select',
                    table: tableName,
                    group: gbFields,
                    fields: [gbFields,
                        {
                            func: {
                                name: operation,
                                args: [{field: aggregationField}]
                            }
                        }]
                });
            }
            let editedGB = gbQuery.query.replace(/"/g, '');
            connection.query(editedGB,   function (error, results3, fields) {
                if (error) throw error;
                connection.query('DROP TABLE ' + tableName, function (err, resultDrop) {
                    if (err) throw err;
                    let groupBySqlResult = transformations.transformGBFromSQL(results3, operation, aggregationField, gbFields);
                   console.log("AAAAAA");
                   console.log(groupBySqlResult);
                   callback(groupBySqlResult);
                });
            });
        });
    });
}

app.get('/getViewByName/:viewName', function (req,res) {
    let fact_tbl = require('./templates/new_sales_min');
    let templ = {};
    if ('template' in fact_tbl) {
        templ = fact_tbl['template'];
    } else {
        templ = fact_tbl;
    }
    let viewsDefined = fact_tbl.views;
    console.log(req.params.viewName);
    let found = false;
    let view = {};
    for(let crnView in viewsDefined){
        if(fact_tbl.views[crnView].name === req.params.viewName) {
            found = true;
            view = fact_tbl.views[crnView];
            break;
        }
    }

    if(!found){
        return res.send({error: "view not found"});
    }

    let gbFields = [];
    console.log(view);
    console.log("***");
    console.log(view.gbFields);
    if (view.gbFields.indexOf('|') > -1) {
        // more than 1 group by fields
        gbFields = view.gbFields.split('|');
    } else {
        if(Array.isArray(view.gbFields)){
            gbFields = view.gbFields;
        } else {
            gbFields.push(view.gbFields);
        }
    }
    view.gbFields = gbFields;
    for(let index in view.gbFields){
        view.gbFields[index] = view.gbFields[index].trim();
    }
    if (contract) {
        contract.methods.groupId().call(function (err, result) {
            if (!err) {
                if(result > 0) { //At least one group by already exists
                    contract.methods.getAllGroupBys(result).call(function (err, resultGB) {
                        if (!err) {
                            let len = Object.keys(resultGB).length;
                            for (let j = 0; j < len / 2; j++) {
                                delete resultGB[j];
                            }
                            let transformedArray = [];
                            console.log(resultGB);
                            for (let j = 0; j < resultGB.hashes.length; j++) {
                                transformedArray[j] = {
                                    hash: resultGB.hashes[j],
                                    latestFact: resultGB.latFacts[j],
                                    columnSize: resultGB.columnSize[j],
                                    columns: resultGB.columns[j],
                                    gbTimestamp: resultGB.gbTimestamp[j]
                                };
                            }

                            transformedArray = containsAllFields(transformedArray, view); //assigns the containsAllFields value
                            let filteredGBs = [];
                            for (let i = 0; i < transformedArray.length; i++) {
                                if (transformedArray[i].containsAllFields) {
                                    filteredGBs.push(transformedArray[i]);
                                }
                            }
                            //filter out the group bys that DO NOT CONTAIN all the fields we need -> aka containsAllFields = false
                            //assign costs
                            filteredGBs = cost(filteredGBs);

                            //pick the one with the less cost
                            filteredGBs.sort(function (a, b) {
                                return parseFloat(a.cost) - parseFloat(b.cost)
                            }); //order ascending
                            let mostEfficient = filteredGBs[0]; // TODO: check what we do in case we have no groub bys that match those criteria
                            contract.methods.dataId().call(function (err, latestId) {
                                if (err) {
                                    console.log(err);
                                    return res.send(err);
                                }
                                if (mostEfficient.gbTimestamp > 0) {
                                    contract.methods.getFact(latestId - 1).call(function (err, latestFact) {
                                        if (err) {
                                            console.log(err);
                                            return res.send(err);
                                        }

                                        if (mostEfficient.gbTimestamp >= latestFact.timestamp) {
                                            //NO NEW FACTS after the latest group by
                                            // -> incrementaly calculate the groupby requested by summing the one in redis cache
                                            client.get(mostEfficient.hash, function (error, cachedGroupBy) {
                                                if (err) {
                                                    console.log(error);
                                                    return res.send(error);
                                                }
                                                cachedGroupBy = JSON.parse(cachedGroupBy);
                                                if (cachedGroupBy.groupByFields.length !== view.gbFields.length) {
                                                    //this means we want to calculate a different group by than the stored one
                                                    //but however it can be calculated just from redis cache
                                                    if (cachedGroupBy.field === view.aggregationField &&
                                                        view.operation === cachedGroupBy.operation) {
                                                        //caclculating the reduced Group By in SQL
                                                        console.log(cachedGroupBy);
                                                        let tableName = cachedGroupBy.gbCreateTable.split(" ");
                                                        tableName = tableName[3];
                                                        tableName = tableName.split('(')[0];
                                                        console.log("TABLE NAME = " + tableName);
                                                        connection.query(cachedGroupBy.gbCreateTable, async function (error, results, fields) {
                                                            if (error) throw error;
                                                            let rows = [];
                                                            let lastCol = "";
                                                            let prelastCol = ""; // need this for AVERAGE calculation where we have 2 derivative columns, first is SUM, second one is COUNT
                                                            await Object.keys(cachedGroupBy).forEach(function (key, index) {
                                                                if (key !== 'operation' && key !== 'groupByFields' && key !== 'field' && key !== 'gbCreateTable') {
                                                                    let crnRow = JSON.parse(key);
                                                                    lastCol = cachedGroupBy.gbCreateTable.split(" ");
                                                                    prelastCol = lastCol[lastCol.length - 4];
                                                                    lastCol = lastCol[lastCol.length - 2];
                                                                    let gbVals = Object.values(cachedGroupBy);
                                                                    if (view.operation === "AVERAGE") {
                                                                        crnRow[prelastCol] = gbVals[index]["sum"];
                                                                        crnRow[lastCol] = gbVals[index]["count"]; //BUG THERE ON AVERAGEEE
                                                                    } else {
                                                                        crnRow[lastCol] = gbVals[index]; //BUG THERE ON AVERAGEEE
                                                                    }
                                                                    rows.push(crnRow);
                                                                }
                                                            });
                                                            let sqlInsert = jsonSql.build({
                                                                type: 'insert',
                                                                table: tableName,
                                                                values: rows
                                                            });
                                                            console.log("SQL QUERY INSERT = ");
                                                            console.log(sqlInsert.query);
                                                            let editedQuery = sqlInsert.query.replace(/"/g, '');
                                                            editedQuery = editedQuery.replace(/''/g, 'null');
                                                            console.log("edited insert query is:");
                                                            console.log(editedQuery);
                                                            await connection.query(editedQuery, async function (error, results, fields) {
                                                                if (error) {
                                                                    console.log(error);
                                                                    throw error;
                                                                }
                                                                console.log("INSERT QUERY RES = ");
                                                                console.log(results);
                                                                let op = "";
                                                                let gbQuery = {};
                                                                if (view.operation === "SUM" || view.operation === "COUNT") {
                                                                    op = "SUM"; //operation is set to "SUM" both for COUNT and SUM operation
                                                                } else if (view.operation === "MIN") {
                                                                    op = "MIN"
                                                                } else if (view.operation === "MAX") {
                                                                    op = "MAX";
                                                                }
                                                                gbQuery = jsonSql.build({
                                                                    type: 'select',
                                                                    table: tableName,
                                                                    group: gbFields,
                                                                    fields: [gbFields,
                                                                        {
                                                                            func: {
                                                                                name: op,
                                                                                args: [{field: lastCol}]
                                                                            }
                                                                        }]
                                                                });
                                                                if (view.operation === "AVERAGE") {
                                                                    gbQuery = jsonSql.build({
                                                                        type: 'select',
                                                                        table: tableName,
                                                                        group: gbFields,
                                                                        fields: [gbFields,
                                                                            {
                                                                                func: {
                                                                                    name: 'SUM',
                                                                                    args: [{field: prelastCol}]
                                                                                }
                                                                            },
                                                                            {
                                                                                func: {
                                                                                    name: 'SUM',
                                                                                    args: [{field: lastCol}]
                                                                                }
                                                                            }]
                                                                    });
                                                                }
                                                                let editedGBQuery = gbQuery.query.replace(/"/g, '');
                                                                editedGBQuery = editedGBQuery.replace(/''/g, 'null');
                                                                await connection.query(editedGBQuery, async function (error, results, fields) {
                                                                    if (error) {
                                                                        console.log(error);
                                                                        throw error;
                                                                    }
                                                                    await connection.query('DROP TABLE ' + tableName, function (err, resultDrop) {
                                                                        if (err) {
                                                                            console.log(err);
                                                                            throw err;
                                                                        }

                                                                        let groupBySqlResult = {};
                                                                        if (view.operation === "AVERAGE") {
                                                                            groupBySqlResult = transformations.transformReadyAverage(results, view.gbFields, view.aggregationField);
                                                                        } else {
                                                                            groupBySqlResult = transformations.transformGBFromSQL(results, op, lastCol, gbFields);
                                                                        }
                                                                        return saveOnCache(groupBySqlResult, view.operation, latestId - 1).on('error', (err) => {
                                                                            console.log('error:', err);
                                                                            res.send(err);
                                                                        }).on('transactionHash', (err) => {
                                                                            console.log('transactionHash:', err);
                                                                        }).on('receipt', (receipt) => {
                                                                            console.log('receipt:', receipt);
                                                                            io.emit('view_results', JSON.stringify(groupBySqlResult));
                                                                            return res.send(JSON.stringify(groupBySqlResult));
                                                                        });
                                                                    });
                                                                });
                                                            });
                                                        });
                                                    } else {
                                                        //some fields contained in a Group by but operation and aggregation fields differ
                                                        //this means we should proceed to new group by calculation from the begining
                                                        getAllFacts(latestId).then(retval => {
                                                            for (let i = 0; i < retval.length; i++) {
                                                                delete retval[i].timestamp;
                                                            }
                                                            console.log("CALCULATING NEW GB FROM BEGGINING");
                                                            calculateNewGroupBy(retval, view.operation, view.gbFields, view.aggregationField, function (groupBySqlResult) {
                                                                saveOnCache(groupBySqlResult, view.operation, latestId - 1).on('error', (err) => {
                                                                    console.log('error:', err);
                                                                    res.send(err);
                                                                }).on('transactionHash', (err) => {
                                                                    console.log('transactionHash:', err);
                                                                }).on('receipt', (receipt) => {
                                                                    console.log('receipt:', receipt);
                                                                    io.emit('view_results', JSON.stringify(groupBySqlResult));
                                                                    return res.send(JSON.stringify(groupBySqlResult));
                                                                });
                                                            });
                                                        });

                                                    }
                                                } else {
                                                    if (cachedGroupBy.field === view.aggregationField &&
                                                        view.operation === cachedGroupBy.operation) {
                                                        //this means we just have to return the group by stored in cache
                                                        //field, operation are same and no new records written
                                                        console.log(cachedGroupBy);
                                                        io.emit('view_results', JSON.stringify(cachedGroupBy));
                                                        return res.send(cachedGroupBy);
                                                    } else {
                                                        //same fields but different operation or different aggregate field
                                                        //this means we should proceed to new group by calculation from the begining
                                                        getAllFacts(latestId).then(retval => {
                                                            for (let i = 0; i < retval.length; i++) {
                                                                delete retval[i].timestamp;
                                                            }
                                                            console.log("CALCULATING NEW GB FROM BEGGINING");
                                                            calculateNewGroupBy(retval, view.operation, view.gbFields, view.aggregationField, function (groupBySqlResult) {
                                                                saveOnCache(groupBySqlResult, view.operation, latestId - 1).on('error', (err) => {
                                                                    console.log('error:', err);
                                                                    res.send(err);
                                                                }).on('transactionHash', (err) => {
                                                                    console.log('transactionHash:', err);
                                                                }).on('receipt', (receipt) => {
                                                                    console.log('receipt:', receipt);
                                                                    io.emit('view_results', JSON.stringify(groupBySqlResult));
                                                                    return res.send(JSON.stringify(groupBySqlResult));
                                                                });
                                                            });
                                                        });
                                                    }
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                            //  return res.send({allGbs: filteredGBs, mostEfficient: mostEfficient});
                        } else {
                            console.log(err);
                            return res.send(err);
                        }
                    })
                } else {
                    //No group bys exist in cache, we are in the initial state
                    //this means we should proceed to new group by calculation from the begining
                    contract.methods.dataId().call(function (err, latestId) {
                        if(err) throw err;
                        getAllFacts(latestId).then(retval => {
                            for (let i = 0; i < retval.length; i++) {
                                delete retval[i].timestamp;
                            }
                            console.log("CALCULATING NEW GB FROM BEGGINING");
                            calculateNewGroupBy(retval, view.operation, view.gbFields, view.aggregationField, function (groupBySqlResult) {
                                saveOnCache(groupBySqlResult, view.operation, latestId - 1).on('error', (err) => {
                                    console.log('error:', err);
                                    res.send(err);
                                }).on('transactionHash', (err) => {
                                    console.log('transactionHash:', err);
                                }).on('receipt', (receipt) => {
                                    console.log('receipt:', receipt);
                                    io.emit('view_results', JSON.stringify(groupBySqlResult));
                                    return res.send(JSON.stringify(groupBySqlResult));
                                });
                            });
                        });
                    });
                }
            } else {
                console.log(err);
                console.log('ERRRRRR');
                return res.send(err);
            }
        });
    }else {
        res.status(400);
        return  res.send({ status: 'ERROR', options: 'Contract not deployed' });
    }
});

app.get('/groupby/:field/:operation/:aggregateField', function (req, res) {
    // LOGIC: IF latestGroupByTS >= latestFactTS RETURN LATEST GROUPBY FROM REDIS
    //      ELSE CALCULATE GROUBY FOR THE DELTAS (AKA THE ROWS ADDED AFTER THE LATEST GROUPBY) AND APPEND TO THE ALREADY SAVED IN REDIS
    console.log("gb hit again");
    if(!gbRunning) {
       // running = true;
        let gbFields = [];
        if (req.params.field.indexOf('|') > -1) {
            // more than 1 group by fields
            gbFields = req.params.field.split('|');
        } else {
            gbFields.push(req.params.field);
        }
        console.log(gbFields);
        if (contract) {
            let timeStart = 0;
            contract.methods.dataId().call(function (err, latestId) {
                contract.methods.getLatestGroupBy(Web3.utils.fromAscii(req.params.operation)).call(function (err, latestGroupBy) {
                    console.log('LATEST GB IS: ');
                    console.log(latestGroupBy);
                    if (latestGroupBy.ts > 0) {
                        contract.methods.getFact(latestId - 1).call(function (err, latestFact) {
                            if (latestGroupBy.ts >= latestFact.timestamp) {
                                //get all groupbys from blockchain and keep only the ones that fields can be calculated from
                                //run cost function
                                //select the one with the less cost and calculate incrementaly
                                // check what is the latest groupBy
                                // if latest groupby contains all fields for the new groupby requested
                                // -> incrementaly calculate the groupby requested by summing the one in redis cache
                                let timeCacheStart = microtime.nowDouble();
                                client.get(latestGroupBy.latestGroupBy, function (error, cachedGroupBy) {
                                    if (error) {
                                        console.log(error);
                                        gbRunning = false;
                                        io.emit('gb_results', error);
                                        res.send(error);
                                    } else {
                                        let timeCacheFinish = microtime.nowDouble();
                                        let timeCache = timeCacheFinish - timeCacheStart;
                                        cachedGroupBy = JSON.parse(cachedGroupBy);
                                        console.log('**');
                                        console.log(cachedGroupBy);
                                        console.log('**');
                                        let containsAllFields = true;
                                        for (let i = 0; i < gbFields.length; i++) {
                                            if (!cachedGroupBy.groupByFields.includes(gbFields[i])) {
                                                containsAllFields = false
                                            }
                                        }
                                        if (containsAllFields && cachedGroupBy.groupByFields.length !== gbFields.length) { //it is a different groupby thna the stored
                                            if (cachedGroupBy.field === req.params.aggregateField &&
                                                req.params.operation === cachedGroupBy.operation) {
                                                let respObj = transformations.calculateReducedGB(req.params.operation, req.params.aggregateField, cachedGroupBy, gbFields);
                                                io.emit('gb_results', JSON.stringify(respObj));
                                                res.send(JSON.stringify(respObj));
                                            }
                                        } else {
                                            console.log('getting it from redis');
                                            timeStart = microtime.nowDouble();
                                            client.get(latestGroupBy.latestGroupBy, function (error, cachedGroupBy) {
                                                if (error) {
                                                    console.log(error);
                                                    io.emit('gb_results', error);
                                                    res.send(error);
                                                } else {
                                                    console.log('GET result ->' + cachedGroupBy);
                                                    let timeFinish = microtime.nowDouble();
                                                    cachedGroupBy = JSON.parse(cachedGroupBy);
                                                    cachedGroupBy.cacheTime = timeCache;
                                                    cachedGroupBy.executionTime = timeFinish - timeStart;
                                                    gbRunning = false;
                                                    io.emit('gb_results', JSON.stringify(cachedGroupBy));
                                                    res.send(JSON.stringify(cachedGroupBy));
                                                }
                                            });
                                        }
                                    }
                                });

                            } else {
                                // CALCULATE GROUPBY FOR DELTAS (fact.timestamp > latestGroupBy timestamp)   AND THEN APPEND TO REDIS
                                //  getFactsFromTo(latestGroupBy.latFactInGb, latestId)
                                //  getAllFacts(latestId).then(retval => {
                                let timeFetchStart = microtime.nowDouble();
                                getFactsFromTo(latestGroupBy.latFactInGb, latestId).then(retval => { // getting just the deltas from the blockchain
                                    let timeFetchEnd = microtime.nowDouble();
                                    // get (fact.timestamp > latestGroupBy timestamp)
                                    let deltas = [];
                                    for (let i = 0; i < retval.length; i++) {
                                        let crnFact = retval[i];
                                        //    if (crnFact.timestamp > latestGroupBy.ts) {
                                        deltas.push(crnFact);
                                        //  }
                                    }
                                    timeStart = microtime.nowDouble();
                                        // calculate groupby for deltas in SQL
                                        let SQLCalculationTimeStart = microtime.nowDouble();
                                        connection.query(createTable, function (error, results, fields) {
                                            if (error) throw error;
                                            for (let i = 0; i < deltas.length; i++) {
                                                delete deltas[i].timestamp;
                                            }

                                            let sql = jsonSql.build({
                                                type: 'insert',
                                                table: tableName,
                                                values: deltas
                                            });

                                            let editedQuery = sql.query.replace(/"/g, '');
                                            editedQuery = editedQuery.replace(/''/g, 'null');
                                            console.log(editedQuery);
                                            connection.query(editedQuery, function (error, results2, fields) {
                                                let gbQuery = null;
                                                if (req.params.operation === 'AVERAGE') {
                                                    gbQuery = jsonSql.build({
                                                        type: 'select',
                                                        table: tableName,
                                                        group: gbFields,
                                                        fields: [gbFields,
                                                            {
                                                                func: {
                                                                    name: 'SUM',
                                                                    args: [
                                                                        {field: req.params.aggregateField}
                                                                    ]
                                                                }
                                                            },
                                                            {
                                                                func: {
                                                                    name: 'COUNT',
                                                                    args: [
                                                                        {field: req.params.aggregateField}
                                                                    ]
                                                                }
                                                            }]
                                                    });
                                                } else {
                                                    gbQuery = jsonSql.build({
                                                        type: 'select',
                                                        table: tableName,
                                                        group: gbFields,
                                                        fields: [gbFields,
                                                            {
                                                                func: {
                                                                    name: req.params.operation,
                                                                    args: [
                                                                        {field: req.params.aggregateField}
                                                                    ]
                                                                }
                                                            }]
                                                    });
                                                }
                                                let editedGB = gbQuery.query.replace(/"/g, '');
                                                connection.query(editedGB, function (error, results3, fields) {
                                                    connection.query('DROP TABLE ' + tableName, function (err, resultDrop) {
                                                        let SQLCalculationTimeEnd = microtime.nowDouble();
                                                        if (!err) {
                                                            let deltaGroupBy = transformations.transformGBFromSQL(results3, req.params.operation, req.params.aggregateField, gbFields);
                                                            let cacheTimeStart = microtime.nowDouble();
                                                            client.get(latestGroupBy.latestGroupBy, function (error, cachedGroupBy) {
                                                                let cacheTimeEnd = microtime.nowDouble();
                                                                if (error) {
                                                                    console.log(error);
                                                                    io.emit('gb_results', error);
                                                                    res.send(error);
                                                                } else {
                                                                    console.log('GET result ->' + cachedGroupBy);
                                                                    // IF COUNT / SUM -> ADD
                                                                    // ELIF MIN -> NEW_MIN = MIN OF MINS
                                                                    cachedGroupBy = JSON.parse(cachedGroupBy);
                                                                    console.log('**');
                                                                    console.log(cachedGroupBy);
                                                                    console.log('**');
                                                                    let containsAllFields = true;
                                                                    let ObCachedGB = {};
                                                                    for (let i = 0; i < gbFields.length; i++) {
                                                                        if (!cachedGroupBy.groupByFields.includes(gbFields[i])) {
                                                                            containsAllFields = false
                                                                        }
                                                                    }
                                                                    if (containsAllFields && cachedGroupBy.groupByFields.length !== gbFields.length) { // it is a different groupby than the stored
                                                                        if (cachedGroupBy.field === req.params.aggregateField &&
                                                                            req.params.operation === cachedGroupBy.operation) {
                                                                            ObCachedGB = transformations.calculateReducedGB(req.params.operation, req.params.aggregateField, cachedGroupBy, gbFields);
                                                                        }
                                                                    } else {
                                                                        //ObCachedGB = JSON.parse(cachedGroupBy);
                                                                        ObCachedGB = cachedGroupBy;
                                                                    }

                                                                    let updatedGB = {};
                                                                    if (ObCachedGB['operation'] === 'SUM') {
                                                                        updatedGB = helper.sumObjects(ObCachedGB, deltaGroupBy);
                                                                    } else if (ObCachedGB['operation'] === 'COUNT') {
                                                                        updatedGB = helper.sumObjects(ObCachedGB, deltaGroupBy);
                                                                    } else if (ObCachedGB['operation'] === 'MAX') {
                                                                        updatedGB = helper.maxObjects(ObCachedGB, deltaGroupBy)
                                                                    } else if (ObCachedGB['operation'] === 'MIN') {
                                                                        updatedGB = helper.minObjects(ObCachedGB, deltaGroupBy)
                                                                    } else { // AVERAGE
                                                                        updatedGB = helper.averageObjects(ObCachedGB, deltaGroupBy)
                                                                    }
                                                                    let timeFinish = microtime.nowDouble();
                                                                    client.set(latestGroupBy.latestGroupBy, JSON.stringify(updatedGB), redis.print);
                                                                    updatedGB.executionTime = timeFinish - timeStart;
                                                                    updatedGB.sqlCalculationTime = SQLCalculationTimeEnd - SQLCalculationTimeStart;
                                                                    updatedGB.cacheTime = cacheTimeEnd - cacheTimeStart;
                                                                    updatedGB.blockchainFetchTime = timeFetchEnd - timeFetchStart;
                                                                    //add the newly calculated groupby in blockchain and redis cache
                                                                    gbRunning = false;
                                                                    io.emit('gb_results', JSON.stringify(updatedGB));
                                                                    res.send(JSON.stringify(updatedGB));
                                                                }
                                                            });
                                                        } else {
                                                            io.emit('gb_results', 'error');
                                                            res.send('error');
                                                        }
                                                    });
                                                });
                                            });
                                        });

                                        // let deltaGroupBy = groupBy(deltas, req.params.field);
                                        // deltaGroupBy = transformGB(deltaGroupBy, req.params.operation, req.params.aggregateField);
                                        // client.get(latestGroupBy.latestGroupBy, function (error, cachedGroupBy) {
                                        //     if (error) {
                                        //         console.log(error);
                                        //         res.send(error);
                                        //     } else {
                                        //         console.log('GET result ->' + cachedGroupBy);
                                        //
                                        //         //IF COUNT / SUM -> ADD
                                        //         //ELIF MIN -> NEW_MIN = MIN OF MINS
                                        //
                                        //         let ObCachedGB = JSON.parse(cachedGroupBy);
                                        //         let updatedGB = {};
                                        //         if (ObCachedGB['operation'] === 'SUM') {
                                        //             updatedGB = sumObjects(ObCachedGB,deltaGroupBy);
                                        //         } else if (ObCachedGB['operation'] === 'COUNT') {
                                        //             updatedGB = sumObjects(ObCachedGB,deltaGroupBy);
                                        //         } else if (ObCachedGB['operation'] === 'MAX') {
                                        //             updatedGB = maxObjects(ObCachedGB,deltaGroupBy)
                                        //         } else if (ObCachedGB['operation'] === 'MIN') {
                                        //             updatedGB = minObjects(ObCachedGB,deltaGroupBy)
                                        //         } else { //AVERAGE
                                        //             updatedGB = averageObjects(ObCachedGB,deltaGroupBy)
                                        //         }
                                        //         let timeFinish = microtime.nowDouble();
                                        //         client.set(latestGroupBy.latestGroupBy, JSON.stringify(updatedGB), redis.print);
                                        //         updatedGB.executionTime = timeFinish - timeStart;
                                        //         res.send(JSON.stringify(updatedGB));
                                        //     }
                                        // });

                                    //      console.log('DELTAS GB---->');
                                    //      console.log(deltaGroupBy);
                                    //      console.log('DELTAS GB---->');
                                    //      console.log(latestGroupBy);
                                }).catch(error => {
                                    console.log(error);
                                });
                            }
                        }).catch(error => {
                            console.log(error);
                        });
                    } else {
                        // NO GROUP BY, SHOULD CALCULATE IT FROM THE BEGGINING
                        console.log("NO GROUP BY, SHOULD CALCULATE IT FROM THE BEGGINING");
                        let timeFetchStart = microtime.nowDouble();
                        getAllFacts(latestId).then(retval => {
                            console.log("got all facts");
                            let timeFetchEnd = microtime.nowDouble();
                            timeStart = microtime.nowDouble();
                            let groupByResult;
                            let timeFinish = 0;
                            const transactionObject = {
                                from: acc,
                                gas: 15000000,
                                gasPrice: '30000000000000'
                            };
                                let SQLCalculationTimeStart = microtime.nowDouble();
                                connection.query(createTable, function (error, results, fields) {
                                    if (error) throw error;
                                    for (let i = 0; i < retval.length; i++) {
                                        delete retval[i].timestamp;
                                    }

                                    let sql = jsonSql.build({
                                        type: 'insert',
                                        table: tableName,
                                        values: retval
                                    });

                                    let editedQuery = sql.query.replace(/"/g, '');
                                    editedQuery = editedQuery.replace(/''/g, 'null');
                                    console.log(editedQuery);
                                    connection.query(editedQuery, function (error, results2, fields) {
                                        let gbQuery = null;
                                        if (req.params.operation === 'AVERAGE') {
                                            gbQuery = jsonSql.build({
                                                type: 'select',
                                                table: tableName,
                                                group: gbFields,
                                                fields: [gbFields,
                                                    {
                                                        func: {
                                                            name: 'SUM', args: [{field: req.params.aggregateField}]
                                                        }
                                                    },
                                                    {
                                                        func: {
                                                            name: 'COUNT', args: [{field: req.params.aggregateField}]
                                                        }
                                                    }]
                                            });
                                        } else {
                                            gbQuery = jsonSql.build({
                                                type: 'select',
                                                table: tableName,
                                                group: gbFields,
                                                fields: [gbFields,
                                                    {
                                                        func: {
                                                            name: req.params.operation,
                                                            args: [{field: req.params.aggregateField}]
                                                        }
                                                    }]
                                            });
                                        }
                                        let editedGB = gbQuery.query.replace(/"/g, '');
                                        connection.query(editedGB, function (error, results3, fields) {
                                            connection.query('DROP TABLE ' + tableName, function (err, resultDrop) {
                                                let SQLCalculationTimeEnd = microtime.nowDouble();
                                                if (!err) {
                                                    let groupBySqlResult = transformations.transformGBFromSQL(results3, req.params.operation, req.params.aggregateField, gbFields);
                                                    //groupBySqlResult.gbCreateTable = "CREATE TEMPORARY TABLE tempTblGB(BrandName varchar(50) charset utf8 null, ProductCategoryName varchar(30) charset utf8 null, UnitPrice float null, COUNTOnlineSalesKey int)";
                                                    groupBySqlResult.gbCreateTable = "CREATE TEMPORARY TABLE tempTblAVG(BrandName varchar(50) charset utf8 null, ProductCategoryName varchar(30) charset utf8 null, UnitPrice float null, SUMUnitPrice float, COUNTUnitPrice int)";
                                                    let timeFinish = microtime.nowDouble();
                                                    md5sum = crypto.createHash('md5');
                                                    md5sum.update(JSON.stringify(groupBySqlResult));
                                                    let hash = md5sum.digest('hex');
                                                    console.log(hash);
                                                    console.log('**');
                                                    console.log(JSON.stringify(groupBySqlResult));
                                                    console.log('**');
                                                    console.log(groupBySqlResult);
                                                    let colSize = groupBySqlResult.groupByFields.length;
                                                    let columns = JSON.stringify({fields: groupBySqlResult.groupByFields});
                                                    client.set(hash, JSON.stringify(groupBySqlResult), redis.print);
                                                    contract.methods.addGroupBy(hash, Web3.utils.fromAscii(req.params.operation), latestId, colSize, columns).send(transactionObject, (err, txHash) => {
                                                        console.log('send:', err, txHash);
                                                    }).on('error', (err) => {
                                                        console.log('error:', err);
                                                        res.send(err);
                                                    }).on('transactionHash', (err) => {
                                                        console.log('transactionHash:', err);
                                                    }).on('receipt', (receipt) => {
                                                        console.log('receipt:', receipt);
                                                        let execT = timeFinish - timeStart;
                                                        groupBySqlResult.executionTime = execT;
                                                        groupBySqlResult.blockchainFetchTime = timeFetchEnd - timeFetchStart;
                                                        groupBySqlResult.sqlCalculationTime = SQLCalculationTimeEnd - SQLCalculationTimeStart;
                                                        gbRunning = false;
                                                        io.emit('gb_results', JSON.stringify(groupBySqlResult));
                                                        res.send(JSON.stringify(groupBySqlResult));
                                                    })
                                                } else {
                                                    gbRunning = false;
                                                    io.emit('gb_results', 'error');
                                                    res.send('error');
                                                }
                                            });
                                        });
                                    });
                                });
                        }).catch(error => {
                            console.log(error);
                        });
                    }
                }).catch(error => {
                    console.log(error);
                });
            });
        } else {
            gbRunning = false;
            res.status(400);
            io.emit('gb_results', JSON.stringify({status: 'ERROR', options: 'Contract not deployed'}));
            res.send({status: 'ERROR', options: 'Contract not deployed'});
        }
    }
});

app.get('/getcount', function (req, res) {
    if (contract) {
        contract.methods.dataId().call(function (err, result) {
            if (!err) {
                res.send(result);
            } else {
                console.log(err);
                console.log('ERRRRRR');
                res.send(err);
            }
        })
    } else {
        res.status(400);
        res.send({status: 'ERROR', options: 'Contract not deployed' });
    }
});

app.post('/addFact', function (req, res) {
    if (contract) {
        const transactionObject = {
            from: acc,
            gas: 1500000,
            gasPrice: '30000000000000'
        };
        console.log(req.body);
        let vals = req.body.values;
        for (let i = 0; i < req.body.values.length; i++) {
            let crnVal = req.body.values[i];
            if (crnVal.type === 'bytes32') {
                req.body.values[i].value = web3.utils.fromAscii(req.body.values[i].value);
            }
        }
        let valsLength = vals.length;
        let addFactPromise;
        if (valsLength === 1) {
            addFactPromise = contract.methods.addFact(vals[0].value);
        } else if (valsLength === 2) {
            addFactPromise = contract.methods.addFact(vals[0].value, vals[1].value);
        } else if (valsLength === 3) {
            addFactPromise = contract.methods.addFact(vals[0].value, vals[1].value, vals[2].value);
        } else if (valsLength === 4) {
            addFactPromise = contract.methods.addFact(vals[0].value, vals[1].value, vals[2].value, vals[3].value);
        } else if (valsLength === 5) {
            addFactPromise = contract.methods.addFact(vals[0].value, vals[1].value, vals[2].value, vals[3].value, vals[4].value);
        } else if (valsLength === 6) {
            addFactPromise = contract.methods.addFact(vals[0].value, vals[1].value, vals[2].value, vals[3].value, vals[4].value, vals[5].value);
        } else if (valsLength === 7) {
            addFactPromise = contract.methods.addFact(vals[0].value, vals[1].value, vals[2].value, vals[3].value, vals[4].value, vals[5].value, vals[6].value);
        } else if (valsLength === 8) {
            addFactPromise = contract.methods.addFact(vals[0].value, vals[1].value, vals[2].value, vals[3].value, vals[4].value, vals[5].value, vals[6].value, vals[7].value);
        } else if (valsLength === 9) {
            addFactPromise = contract.methods.addFact(vals[0].value, vals[1].value, vals[2].value, vals[3].value, vals[4].value, vals[5].value, vals[6].value, vals[7].value, vals[8].value);
        } else if (valsLength === 10) {
            addFactPromise = contract.methods.addFact(vals[0].value, vals[1].value, vals[2].value, vals[3].value, vals[4].value, vals[5].value, vals[6].value, vals[7].value, vals[8].value, vals[9].value);
        } else if (valsLength === 52) {
            addFactPromise = contract.methods.addFact(vals[0].value, vals[1].value, vals[2].value, vals[3].value, vals[4].value, vals[5].value, vals[6].value, vals[7].value, vals[8].value, vals[9].value,
                vals[10].value, vals[11].value, vals[12].value, vals[13].value, vals[14].value, vals[15].value, vals[16].value, vals[17].value, vals[18].value, vals[19].value,
                vals[20].value, vals[21].value, vals[22].value, vals[23].value, vals[24].value, vals[25].value, vals[26].value, vals[27].value, vals[28].value, vals[29].value,
                vals[30].value, vals[31].value, vals[32].value, vals[33].value, vals[34].value, vals[35].value, vals[36].value, vals[37].value, vals[38].value, vals[39].value,
                vals[40].value, vals[41].value, vals[42].value, vals[43].value, vals[44].value, vals[45].value, vals[46].value, vals[47].value, vals[48].value, vals[49].value,
                vals[50].value, vals[51].value);
        } else {
            res.status(400);
            res.send({ status: 'ERROR', options: 'Contract not supporting more than 10 fields' });
        }
        addFactPromise.send(transactionObject, (err, txHash) => {
            console.log('send:', err, txHash);
        }).on('error', (err) => {
            console.log('error:', err);
            res.send(err);
        }).on('transactionHash', (err) => {
            console.log('transactionHash:', err);
        }).on('receipt', (receipt) => {
            console.log('receipt:', receipt);
            res.send(receipt);
        })
    } else {
        res.status(400);
        res.send({ status: 'ERROR', options: 'Contract not deployed' });
    }
});