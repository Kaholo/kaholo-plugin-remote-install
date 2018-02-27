const child_process = require('child_process');
const path = require('path');
const fs = require('fs');
const SSH = require('simple-ssh');

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

function installAgent(host, user, pass, key, serverUrl, agentPort) {
    const config = { host, user, pass, key };
    const ssh = new SSH(config);


    const tmp_key_file_name = guid() + '.pem';
    let keypath = path.join(__dirname, tmp_key_file_name);
    if (key) {
        fs.writeFileSync(keypath, key);
        child_process.execSync(`chmod 600 ${keypath}`); // changing permission to pem file
    }

    let connectionSSHString = 'ssh -o StrictHostKeyChecking=no';
    if (key) {
        connectionSSHString += ` -i ${keypath}`
    }
    if (pass) {
        connectionSSHString += ` ${user}:${pass}`
    } else {
        connectionSSHString += ` ${user}`
    }
    connectionSSHString += `@${host}`;
    child_process.execSync(connectionSSHString);

    return new Promise((resolve, reject) => {
        ssh.exec(`mkdir -p ${INSTALLATION_PATH}`, {
            out: function (stdout) {
                console.log(stdout);
            },
            exit: function (code, stdout, stderr) {
                console.log(code, stderr);
                resolve();
            }
        }).start();
    }).then(() => new Promise((resolve, reject) => {

        /* transfer zipfile to remote server */
        let scpActionString = 'scp';
        if (key) {
            scpActionString += ` -i ${keypath}`
        }
        scpActionString += ' ' + INSTALLATION_PACKAGE_DIST;
        if (pass) {
            scpActionString += ` ${user}:${pass}`
        } else {
            scpActionString += ` ${user}`
        }
        scpActionString += `@${host}:${INSTALLATION_PATH}`;
        console.log(scpActionString);
        child_process.exec(scpActionString, (error, stdout, stderr) => {
            if (error) {
                console.log('an error occured');
                return reject();
            }
            console.log(error, stdout, stderr);
            resolve();
        });
    })).then(() => new Promise((resolve, reject) => {
        let installationScript = fs.readFileSync(path.join(__dirname, 'install_agent.txt')).toString();
        installationScript = installationScript.replace(new RegExp('INSTALLATION_PATH', 'g'), INSTALLATION_PATH);
        installationScript = installationScript.replace(new RegExp('{{SERVER_URL}}', 'g'), (serverUrl || env.server_url));
        installationScript = installationScript.replace(new RegExp('{{PORT}}', 'g'), agentPort? `--PORT=${agentPort}` : '');

        console.log(installationScript);
        ssh
            .exec('sudo apt-get install unzip -y', {
                out: function (stdout) {
                    console.log(stdout);
                },
                exit: function (code, stdout, stderr) {
                    console.log(code, stdout, stderr)
                }
            })
            .exec(`unzip -o ${INSTALLATION_PATH}/installation_package.zip -d ${INSTALLATION_PATH}`, {
                out: function (stdout) {
                    console.log(stdout);
                },
                exit: function (code, stdout, stderr) {
                    console.log('')
                }
            })
            .exec(`cd ${INSTALLATION_PATH}`)
            .exec(`echo '${installationScript}' > ${INSTALLATION_PATH}/install.sh`, {
                exit: function (code, stdout, stderr) {
                    console.log(code, stdout, stderr);
                }
            })
            .exec(`chmod 777  ${INSTALLATION_PATH}/install.sh`, {
                out: function (stdout) {
                    console.log('chmod ', stdout);
                },
                exit: function (code, stdout, stderr) {
                    if (stderr) { return reject(stderr) }
                    console.log(code, stdout, stderr);
                }
            })
            .exec(`sudo ${INSTALLATION_PATH}/install.sh`, {
                out: function (stdout) {
                    console.log('script ', stdout);
                },
                exit: function (code, stdout, stderr) {
                    console.log(code, stdout, stderr);
                    resolve();
                }
            })
            .start();
    })).then(() => new Promise((resolve, reject) => {
        fs.unlinkSync(keypath);
        resolve();
    }));


}

function main(argv) {

    if (argv.length < 3) {
        console.log('Not enough parameters');
        // Invalid Argument
        // Either an unknown option was specified, or an option requiring a value was provided without a value.
        process.exit(9);
    }

    const action = JSON.parse(argv[2]);

    installAgent(
        action.params.HOST,
        action.params.USER,
        action.params.PASS,
        action.params.KEY,
        action.params.PM_SERVER_URL,
        action.params.PM_AGENT_PORT).then((res) => {
        process.exit(0);
    }).catch(err => {
        console.log('An error occurred', err);
        // Uncaught Fatal Exception
        // There was an uncaught exception, and it was not handled by a domain or an 'uncaughtException' event handler.
        process.exit(1); // Failure
    });
}

main(process.argv);