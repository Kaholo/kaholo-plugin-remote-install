const child_process = require('child_process');
const path = require('path');
const fs = require('fs');

const request = require('request');
const env = require('../../../core/src/environment/environment');

const SERVER_URL = env.server_url;

const INSTALLATION_PATH = `/tmp/pminstall_${(new Date).toLocaleDateString('he-IL').split('.').join('_')}`;
const INSTALLATION_PACKAGE_DIST = path.join(__dirname, 'installation_package.zip');


function guid() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }

    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}

function installAgent(action) {

    let host = action.params.HOST, ;
    let user = action.params.USER, ;
    let pass = action.params.PASS, ;
    let key = action.params.KEY, ;
    let serverUrl = action.params.PM_SERVER_URL, ;
    let agentPort = action.params.PM_AGENT_PORT, ;
    let agentName = action.params.AGENT_NAME, ;
    let attributes = (action.params.AGENT_ATTRIBUTES || '').split(',');

    const tmp_key_file_name = guid() + '.txt';
    let keypath = path.join(__dirname, tmp_key_file_name);
    if (key) {
        fs.writeFileSync(keypath, key);
        child_process.execSync(`chmod 600 ${keypath}`); // changing permission to pem file
    }

    let connectionSSHString = 'ssh -o StrictHostKeyChecking=no';
    if (key) {
        connectionSSHString += ` -i ${keypath}`
    }

    connectionSSHString += pass ? ` ${user}:${pass}` : ` ${user}`;
    connectionSSHString += `@${host}`;
    
    // creating the directory and installing unzip
    child_process.execSync(`${connectionSSHString} "mkdir -p ${INSTALLATION_PATH}; sudo apt install unzip -y;"`);
    let scpActionString = 'scp';
    
    if (key) {
        scpActionString += ` -i ${keypath}`
    }

    scpActionString += ' ' + INSTALLATION_PACKAGE_DIST;
    scpActionString += pass ? ` ${user}:${pass}` : ` ${user}`;
    
    scpActionString += `@${host}:${INSTALLATION_PATH}`;
    return new Promise((resolve, reject) => {

        // transferring the package
        child_process.exec(scpActionString, (error, stdout, stderr) => {
            if (error) {
                console.log('an error occurred', error);
                return reject(error);
            }
            console.log(error, stdout, stderr);
            resolve();
        });
    }).then(() => new Promise((resolve, reject) => {
            let installationScript = fs.readFileSync(path.join(__dirname, 'install_agent.txt')).toString();
            installationScript = installationScript.replace(new RegExp('INSTALLATION_PATH', 'g'), INSTALLATION_PATH);
            installationScript = installationScript.replace(new RegExp('{{SERVER_URL}}', 'g'), (serverUrl || env.server_url));
            installationScript = installationScript.replace(new RegExp('{{PORT}}', 'g'), (agentPort || '8090'));
            installationScript = installationScript.replace(new RegExp('{{AGENT_NAME}}', 'g'), agentName ? `--NAME=${agentName}` : '');
            let attrs = '';

            attributes.forEach((attr) => {
                if (attr) {
                    attrs += `--TAG=${attr} `;
                }
            });

            installationScript = installationScript.replace(new RegExp('{{ATTRIBUTES}}', 'g'), attrs);


            // unzipping, creating script file on remote and running it
            child_process.execSync(`${connectionSSHString} "unzip -o ${INSTALLATION_PATH}/installation_package.zip -d ${INSTALLATION_PATH}; echo '${installationScript}' > ${INSTALLATION_PATH}/install.sh; chmod 777 ${INSTALLATION_PATH}/install.sh; sudo ${INSTALLATION_PATH}/install.sh"`);
            resolve();
        })).then(() => new Promise((resolve, reject) => {
            if (!agentName) { return resolve() }

            let interval = setInterval(() => {
                request.get(env.server_url + '/api/agents/status', (error, responseCode, body) => {
                    // console.log(body);
                    if (typeof (body) === 'object') {
                        Object.keys(body).forEach((key) => {
                            if (body[key].hasOwnProperty('name') && body[key].name === agentName) {
                                clearInterval(interval);
                                return resolve(body);
                            }
                        })
                    }

                });
            }, 10000);
        }))
        .then(() => new Promise((resolve, reject) => {
            fs.unlinkSync(keypath);
            resolve();
        }));
}

module.exports = {
    installAgent: installAgent
}