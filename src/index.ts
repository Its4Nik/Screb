import express from "express";
import { exec } from "child_process";
import path from "path";
import fs from "fs-extra";
import yaml from "yaml";
import bodyParser from "body-parser";


const app = express();
const PORT = process.env.PORT || 3000;
const configPath = path.join(__dirname, "..", "config.yaml");

// Middleware to parse JSON body
app.use(bodyParser.json());

// Middleware to log requests
app.use((req, res, next) => {
    const timestamp = `${new Date().toISOString()} - IP: ${req.ip}`;
    console.log(`[${timestamp}] Request URL: ${req.originalUrl}`);
    writeToLogFile(`[${timestamp}] Request URL: ${req.originalUrl}`);
    next();
});

// Load shortlinks from YAML config
let shortlinks: { [key: string]: string } = {};

// Check if config file exists, parse it, and load shortlinks
if (fs.existsSync(configPath)) {
    const configFile = fs.readFileSync(configPath, "utf8");
    const config = yaml.parse(configFile);
    shortlinks = config.shortlinks || {};
}

// Function to update execution counts and store them in a JSON file
const updateExecutionCounts = (scriptName: string) => {
    const executionCountsPath = path.join(
        __dirname,
        "..",
        "executionCounts.json"
    );
    let executionCounts: { [key: string]: number } = {};
    if (fs.existsSync(executionCountsPath)) {
        const executionCountsFile = fs.readFileSync(executionCountsPath, "utf8");
        executionCounts = JSON.parse(executionCountsFile);
    }

    // Increment execution count for the script
    executionCounts[scriptName] = (executionCounts[scriptName] || 0) + 1;

    // Write updated execution counts to the JSON file
    fs.writeFileSync(
        executionCountsPath,
        JSON.stringify(executionCounts, null, 2)
    );
};

// Function to check and limit the size of the log file
const limitLogFileSize = (logFilePath: string, maxSizeInBytes: number) => {
    const stats = fs.statSync(logFilePath);
    const fileSizeInBytes = stats.size;

    if (fileSizeInBytes > maxSizeInBytes) {
        // Read the existing log file
        const data = fs.readFileSync(logFilePath, "utf8");

        // Split the log content into lines
        const lines = data.split("\n");

        // Retain the last 100 lines
        const truncatedContent = lines.slice(-100).join("\n");

        // Write the truncated content back to the log file
        fs.writeFileSync(logFilePath, truncatedContent);
    }
};

// Function to write to the log file
const writeToLogFile = (message: string) => {
    const logFilePath = path.join(__dirname, "..", "log.txt");
    limitLogFileSize(logFilePath, 1048576); // Check and limit file size before writing
    fs.appendFileSync(logFilePath, `${message}\n`);
};

// Function to update group execution counts and store them in a separate JSON file
const updateGroupExecutionCounts = (groupName: string) => {
    const groupExecutionCountsPath = path.join(
        __dirname,
        "..",
        "groupExecutionCounts.json"
    );
    let groupExecutionCounts: { [key: string]: number } = {};
    if (fs.existsSync(groupExecutionCountsPath)) {
        const groupExecutionCountsFile = fs.readFileSync(
            groupExecutionCountsPath,
            "utf8"
        );
        groupExecutionCounts = JSON.parse(groupExecutionCountsFile);
    }

    // Increment execution count for the group
    groupExecutionCounts[groupName] = (groupExecutionCounts[groupName] || 0) + 1;

    // Write updated execution counts to the JSON file
    fs.writeFileSync(
        groupExecutionCountsPath,
        JSON.stringify(groupExecutionCounts, null, 2)
    );
};

// Function to execute a script with optional POST body and query parameters
const executeScript = async (
    scriptPath: string,
    body: object | null,
    query: any,
    scriptName: string
): Promise<void> => {
    return new Promise((resolve, reject) => {
        // Execute the script
        const process = exec(
            `sh ${scriptPath} ${query}`,
            (error, stdout, stderr) => {
                if (error) {
                    // Reject promise if there's an error
                    reject(stderr);
                } else {
                    // Resolve promise with script output
                    resolve(stdout);
                }
            }
        );

        // Pass request body to script's stdin if exists
        if (body && Object.keys(body).length > 0 && process.stdin) {
            process.stdin.write(JSON.stringify(body));
            process.stdin.end();
        }
    })
        .then(() => {
            // Update execution counts after successful execution
            updateExecutionCounts(scriptName);
        })
        .catch((error) => {
            console.error(`Error executing ${scriptName}:`, error);
            const timestamp = `${new Date().toISOString()}`;
            writeToLogFile(`[${timestamp}] Error executing ${scriptName}:`);
            throw error; // Re-throw error to handle it in the main handler
        });
};

// Function to execute all scripts in a directory with optional POST body and query parameters
const executeScriptsInDirectory = async (
    directoryPath: string,
    body: object | null,
    query: any
): Promise<string[]> => {
    const results: string[] = [];
    const files = fs.readdirSync(directoryPath);

    const scriptPromises = files.map(async (file) => {
        const filePath = path.join(directoryPath, file);
        if (fs.lstatSync(filePath).isFile()) {
            try {
                // Execute script
                const result = await executeScript(filePath, body, query, file);
                return result;
            } catch (error) {
                // Return error message if script execution fails
                return `Error executing ${file}: ${error}`;
            }
        }
    });

    // Wait for all script executions to complete and collect their results
    const scriptResults = await Promise.allSettled(scriptPromises);
    results.push(
        ...scriptResults.map((result) =>
            result.status === "fulfilled" ? result.value : result.reason
        )
    );

    return results;
};

// Define a route for the logs subpage
app.get("/logs", (req, res) => {
    const logPath = path.join(__dirname, "..", "log.txt");
    // Read the log file
    fs.readFile(logPath, "utf8", (err, data) => {
        if (err) {
            const timestamp = `${new Date().toISOString()} - IP: ${req.ip}`;
            console.error(`[${timestamp}] Error reading log file:`, err);
            res.status(500).send(`[${timestamp}] Error reading log file`);
            return;
        }

        // Split the log content into lines
        const lines = data.split("\n");
        // Extract the last 10 lines
        const allLines = lines.slice().join("\n");
        // Send the last 1000 lines as plain text response
        res.type("text/plain").send(allLines);
    });
});

app.get("/100-logs", (req, res) => {
    const logPath = path.join(__dirname, "..", "log.txt");
    // Read the log file
    fs.readFile(logPath, "utf8", (err, data) => {
        if (err) {
            const timestamp = `${new Date().toISOString()} - IP: ${req.ip}`;
            console.error(`[${timestamp}] Error reading log file:`, err);
            res.status(500).send(`[${timestamp}] Error reading log file`);
            return;
        }

        // Split the log content into lines
        const lines = data.split("\n");
        // Extract the last 100 lines
        const lastLines = lines.slice(-100).join("\n");
        // Send the last 100 lines as plain text response
        res.type("text/plain").send(lastLines);
    });
});


app.get("/stats", (req, res) => {

    // Get all available scripts and groups from the 'scripts' directory
    const scriptsDirectory = path.join(__dirname, "..", "scripts");
    const availableFiles = fs.readdirSync(scriptsDirectory);
    const availableScripts = availableFiles.filter((file) =>
        fs.lstatSync(path.join(scriptsDirectory, file)).isFile()
    );
    const availableGroups = availableFiles.filter((file) =>
        fs.lstatSync(path.join(scriptsDirectory, file)).isDirectory()
    );

    // Read the execution counts from the JSON file
    const executionCountsPath = path.join(
        __dirname,
        "..",
        "executionCounts.json"
    );
    let executionCounts = {};
    if (fs.existsSync(executionCountsPath)) {
        executionCounts = JSON.parse(fs.readFileSync(executionCountsPath, "utf8"));
    }

    // Read the group execution counts from the JSON file
    const groupExecutionCountsPath = path.join(
        __dirname,
        "..",
        "groupExecutionCounts.json"
    );
    let groupExecutionCounts = {};
    if (fs.existsSync(groupExecutionCountsPath)) {
        groupExecutionCounts = JSON.parse(fs.readFileSync(groupExecutionCountsPath, "utf8"));
    }

    const scriptNames = Object.keys(executionCounts);
    const scriptExecutions = Object.values(executionCounts);
    const groupNames = Object.keys(groupExecutionCounts);
    const groupExecutions = Object.values(groupExecutionCounts);

    // Render the stats page
    const statsHtml = `
    <!DOCTYPE html>
    <html lang="en">
    
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Screb - Stats</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            body {
                    font-family: Arial, sans-serif;
                    background-color: #f4f4f4;
                    padding: 20px;
                    height: 100vh;
                }
                .bubble-footer {
                    font-family: Arial, sans-serif;
                    background-color: #fff;
                    border-radius: 8px;
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
                    padding: 5px;
                    margin-bottom: 10px;
                    width: 790px;
                    justify-content: center;
                    }
                a {
                    color: black;
                    text-decoration: none;
                }
                .chart-container {
                    margin-right: 20px;
                    float: left;
                    width: 100%;
                }
                .chart-container:last-child {
                    margin-right: 0;
                }
                pre {
                    background-color: #fff;
                    padding: 10px;
                    border-radius: 5px;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                }
                .spinner {
                    width: 200px;
                    height: 200px;
                    border: 20px solid rgba(0, 0, 0, 0.1);
                    border-top: 20px solid #3498db;
                    border-radius: 50%;
                    display: flex;
                    animation: spin 1s linear infinite;
                }
                                
                @keyframes spin {
                    0% {
                        transform: rotate(0deg);
                    }
                    100% {
                        transform: rotate(360deg);
                    }
                }
                .spinner-capsule {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 20px;
                    height: auto;
                }

                .grid{
                    gap: 20px;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    grid-template-areas:
                        "script-execution-chart group-execution-chart"
                        "script-execution-chart group-execution-chart";
                    justify-content: center;
                    align-items: center;
                }
                canvas{
                    height: 100% !important;
                    width: 100% !important;
                }
                .log-btn{
                    display: grid;
                    grid-template-columns: 50% 50%;
                }

                .log-btn button{
                    margin-left: auto;
                    cursor: pointer;
                    padding: 5px 10px;
                    background-color: #007bff;
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    font-size: 14px;
                    width: 25%;
                }
        </style>
    </head>
    <body>
        <div style="min-height: 100vh">
            <div class="grid">
                <div class="chart-container">
                    <canvas id="script-execution-chart"></canvas>
                </div>
                <div class="chart-container">
                    <canvas id="group-execution-chart"></canvas>
                </div>
            </div>
                
            <div id="log-lines"></div>

        </div>

        <footer style="position: sticky; bottom: 0; left: 0; width: 100%; padding: 10px 0; text-align: center; border-top-left-radius: 20px; border-top-right-radius: 20px; background: linear-gradient(0deg, rgba(244, 244, 244, 1) 0%, rgba(244, 244, 244, 0) 100%); display: flex; justify-content: center;">
            <div class="bubble-footer" ; style="display: flex; align-items: center;">
                <a href="https://github.com/its4nik/screb" target="_blank" style="margin: 0 10px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                                <path fill="#000000" d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.21 11.387.6.111.793-.261.793-.577 0-.285-.012-1.04-.014-2.04-3.359.717-4.063-1.625-4.063-1.625-.548-1.387-1.336-1.756-1.336-1.756-1.092-.746.084-.731.084-.731 1.206.084 1.838 1.237 1.838 1.237 1.07 1.832 2.809 1.304 3.497.998.109-.776.42-1.304.764-1.604-2.675-.303-5.487-1.336-5.487-5.93 0-1.312.469-2.383 1.237-3.226-.135-.303-.537-1.523.104-3.176 0 0 1.008-.322 3.3 1.23.957-.267 1.982-.4 3-.405 1.016.005 2.041.138 2.998.405 2.29-1.552 3.297-1.23 3.297-1.23.643 1.653.239 2.873.117 3.176.77.843 1.236 1.914 1.236 3.226 0 4.606-2.816 5.622-5.489 5.918.43.37.823 1.101.823 2.223 0 1.605-.014 2.896-.014 3.287 0 .32.191.695.799.574C20.566 21.797 24 17.296 24 12c0-6.627-5.373-12-12-12z"/>
                            </svg>
                </a>
                <p> Made with </p>
                <p>&nbsp;💖</p>
                <p style="margin: 0 25px;">-</p>
                <a href="/stats" style="margin: 0 5px;">
                    <p>Stats</p>
                </a>
                <a href="/logs" style="margin: 0 5px;">
                    <p>Logs</p>
                </a>
                <a href="/" style="margin: 0 5px;">
                    <p>Home</p>
                </a>
            </div>
        </footer>
        <script>
            const scriptNames = ${JSON.stringify(scriptNames)};
                const scriptExecutions = ${JSON.stringify(scriptExecutions)};
                const groupNames = ${JSON.stringify(groupNames)};
                const groupExecutions = ${JSON.stringify(groupExecutions)};
        
                const scriptCtx = document.getElementById('script-execution-chart').getContext('2d');
                new Chart(scriptCtx, {
                    type: 'bar',
                    data: {
                        labels: scriptNames,
                        datasets: [{
                            label: 'Script Executions',
                            data: scriptExecutions,
                            backgroundColor: 'rgba(75, 192, 192, 0.2)',
                            borderColor: 'rgba(75, 192, 192, 1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        indexAxis: 'x',
                        scales: {
                            y: {
                                beginAtZero: true
                            }
                        }
                    }
                });
        
                const groupCtx = document.getElementById('group-execution-chart').getContext('2d');
                new Chart(groupCtx, {
                    type: 'bar',
                    data: {
                        labels: groupNames,
                        datasets: [{
                            label: 'Group Executions',
                            data: groupExecutions,
                            backgroundColor: 'rgba(153, 102, 255, 0.2)',
                            borderColor: 'rgba(153, 102, 255, 1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        indexAxis: 'x',
                        scales: {
                            y: {
                                beginAtZero: true
                            }
                        }
                    }
                });
        
                document.getElementById('log-lines').innerHTML = "<div class='spinner-capsule'><div class='spinner'></div></div>";

                fetch('/100-logs')
                    .then(response => response.text())
                    .then(logLines => {
                        document.getElementById('log-lines').innerHTML = "<div style='clear:both;'></div><div class='log-btn'><h2>Last 100 Log lines:</h2><button onclick='location.href=&quot;/logs&quot;'>See all logs</button></div><pre></pre>";
                        document.querySelector('#log-lines pre').innerText = logLines;
                    })
                    .catch(error => {
                        console.error('Error fetching log:', error);
                    });
        </script>
    </body>
    </html>
    `;
    res.send(statsHtml);
});


// Handle all requests for shortlinkOrScript// Handle all requests for shortlinkOrScript
app.all("/:shortlinkOrScript*", async (req: express.Request<{ shortlinkOrScript?: string }>, res) => {
    const timestamp = `${new Date().toISOString()} - IP: ${req.ip}`;
    const configFile = fs.readFileSync(configPath, "utf8");
    const config = yaml.parse(configFile);
    const shortlinkOrScript = req.params.shortlinkOrScript;

    if (!shortlinkOrScript) {
        res.redirect("/");
        return;
    }

    const scriptPath = path.join(
        __dirname,
        "..",
        "scripts",
        shortlinks[shortlinkOrScript] || shortlinkOrScript
    );
    const query = Object.keys(req.query)
        .map((key) => `${key}=${req.query[key]}`)
        .join("&");

    try {
        if (fs.existsSync(scriptPath)) {
            if (fs.lstatSync(scriptPath).isFile()) {
                console.log(`[${timestamp}] Executing script: ${shortlinkOrScript}`);
                writeToLogFile(`[${timestamp}] Executing script: ${shortlinkOrScript}`);
                if (
                    !config.excludeScripts ||
                    !config.excludeScripts.includes(shortlinkOrScript)
                ) {
                    await executeScript(scriptPath, req.body, query, shortlinkOrScript);
                } else {
                    console.log(`[${timestamp}] Script ${shortlinkOrScript} is excluded from execution.`);
                    writeToLogFile(`[${timestamp}] Script ${shortlinkOrScript} is excluded from execution.`);
                }
            } else if (fs.lstatSync(scriptPath).isDirectory()) {
                console.log(`[${timestamp}] Executing scripts in directory: ${shortlinkOrScript}`);
                writeToLogFile(`[${timestamp}] Executing scripts in directory: ${shortlinkOrScript}`);
                const requestedScriptPath = path.join(scriptPath, "index.sh");
                if (
                    fs.existsSync(requestedScriptPath) &&
                    fs.lstatSync(requestedScriptPath).isFile()
                ) {
                    console.log(`[${timestamp}] Executing script directly: ${shortlinkOrScript}`);
                    writeToLogFile(`[${timestamp}] Executing script directly: ${shortlinkOrScript}`);
                    if (
                        !config.excludeScripts ||
                        !config.excludeScripts.includes(shortlinkOrScript)
                    ) {
                        await executeScript(
                            requestedScriptPath,
                            req.body,
                            query,
                            shortlinkOrScript
                        );
                    } else {
                        console.log(`[${timestamp}] Script ${shortlinkOrScript} is excluded from execution.`);
                        writeToLogFile(`[${timestamp}] Script ${shortlinkOrScript} is excluded from execution.`);
                    }
                } else {
                    await executeScriptsInDirectory(scriptPath, req.body, query);
                }
                // Update group execution count only if it's a directory
                updateGroupExecutionCounts(shortlinkOrScript);
                console.log(`[${timestamp}] Executed group: ${shortlinkOrScript}`);
                writeToLogFile(`[${timestamp}] Executed group: ${shortlinkOrScript}`);
            }
            res.redirect("/");
        } else {
            res.redirect("/");
        }
    } catch (error) {
        console.error(`[${timestamp}] Error executing ${shortlinkOrScript}:`, error);
        writeToLogFile(`[${timestamp}] Error executing ${shortlinkOrScript}:`);
        res.redirect("/");
    }
}
);

// Serve the YAML config file and available routes at the base URL
app.get("/", (req, res) => {
    let configFile = "";
    if (fs.existsSync(configPath)) {
        configFile = fs.readFileSync(configPath, "utf8");
    }

    // Get all available scripts and groups from the 'scripts' directory
    const scriptsDirectory = path.join(__dirname, "..", "scripts");
    const availableFiles = fs.readdirSync(scriptsDirectory);
    const availableScripts = availableFiles.filter((file) =>
        fs.lstatSync(path.join(scriptsDirectory, file)).isFile()
    );
    const availableGroups = availableFiles.filter((file) =>
        fs.lstatSync(path.join(scriptsDirectory, file)).isDirectory()
    );

    // Read the execution counts from the JSON file
    const executionCountsPath = path.join(
        __dirname,
        "..",
        "executionCounts.json"
    );
    let executionCounts: { [key: string]: number } = {};
    if (fs.existsSync(executionCountsPath)) {
        const executionCountsFile = fs.readFileSync(executionCountsPath, "utf8");
        executionCounts = JSON.parse(executionCountsFile);
    }

    // Read the group execution counts from the JSON file
    const groupExecutionCountsPath = path.join(
        __dirname,
        "..",
        "groupExecutionCounts.json"
    );
    let groupExecutionCounts: { [key: string]: number } = {};
    if (fs.existsSync(groupExecutionCountsPath)) {
        const groupExecutionCountsFile = fs.readFileSync(
            groupExecutionCountsPath,
            "utf8"
        );
        groupExecutionCounts = JSON.parse(groupExecutionCountsFile);
    }

    const scriptNames = Object.keys(executionCounts);
    const scriptExecutions = Object.values(executionCounts);
    const groupNames = Object.keys(groupExecutionCounts);
    const groupExecutions = Object.values(groupExecutionCounts);

    const configHtml = `
    <!DOCTYPE html>
    <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Screb  - Homepage</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.25.0/themes/prism-tomorrow.min.css">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.25.0/components/prism-core.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.25.0/components/prism-yaml.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
                .main {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
                padding: 20px;
                box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
                border-radius: 8px;
                max-width: 800px;
                margin: 0 auto;
                position: relative;
                display: grid;
                gap: 20px;
                }
                a {
                color: black; /* Making the text white */
                text-decoration: none; /* Removing underline */
                margin: 0 10px;
                }
                h1 {
                text-align: center;
                }
                .bubble {
                background-color: #fff;
                border-radius: 8px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
                padding: 20px;
                display: grid;
                gap: 20px;
                }
                .bubble-footer {
                font-family: Arial, sans-serif;
                background-color: #fff;
                border-radius: 8px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
                padding: 5px;
                margin-bottom: 10px;
                width: 790px;
                justify-content: center;
                }
                .copy-btn {
                position: absolute;
                top: 10px;
                right: 10px;
                cursor: pointer;
                padding: 5px 10px;
                background-color: #007bff;
                color: #fff;
                border: none;
                border-radius: 4px;
                font-size: 14px;
                }
                #logo {
                position: absolute;
                top: 20px;
                left: 20px;
                border-radius: 20px; /* Rounding edges */
                overflow: hidden; /* Ensure rounded edges */
                width: auto; /* Adjust size as needed */
                height: 50px; /* Adjust size as needed */
                }
            </style>
        </head>
        <body>
            <div class="main">
                <img id="logo" alt="Screb Logo" src="data:image/png;base64,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">
                <h1>Screb - Configuration</h1>
                <div class="bubble">
                    <h2>YAML Configuration:</h2>
                    <pre><code class="language-yaml">${configFile}</code></pre>
                    <button class="copy-btn" onclick="copyToClipboard()">Copy YAML</button>
                </div>
                <div class="bubble">
                    <h2>Available Scripts:</h2>
                    ${availableScripts
            .map(
                (script) => `
                    <div class="bubble">
                        <h3>${script}</h3>
                        <p>Total Executions: ${executionCounts[script] || 0}</p>
                    </div>
                    `
            )
            .join("")}
                </div>
                <div class="bubble">
                    <h2>Available Groups:</h2>
                    ${availableGroups
            .map(
                (group) => `
                    <div class="bubble">
                        <h3>${group}</h3>
                        <p>Total Executions: ${groupExecutionCounts[group] || 0}</p>
                        <ul>
                            ${fs
                        .readdirSync(path.join(scriptsDirectory, group))
                        .map(
                            (file) => `
                            <li>${file}</li>
                            `
                        )
                        .join("")}
                        </ul>
                    </div>
                    `
            )
            .join("")}
                </div>
                <div class="bubble">
                    <h2>Script Execution Chart:</h2>
                    <div id="script-chart-container">
                        <canvas id="script-execution-chart"></canvas>
                    </div>
                </div>
                <div class="bubble">
                    <h2>Group Execution Chart:</h2>
                    <div id="group-chart-container">
                        <canvas id="group-execution-chart"></canvas>
                    </div>
                </div>
                <script>
                    function copyToClipboard() {
                        const text = document.querySelector('pre code');
                        const textarea = document.createElement('textarea');
                        textarea.value = text.innerText;
                        document.body.appendChild(textarea);
                        textarea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textarea);
                        alert('Copied to clipboard!');
                    }
                    
                    const scriptNames = ${JSON.stringify(scriptNames)};
                    const scriptExecutions = ${JSON.stringify(scriptExecutions)};
                    const groupNames = ${JSON.stringify(groupNames)};
                    const groupExecutions = ${JSON.stringify(groupExecutions)};
                    
                    const scriptCtx = document.getElementById('script-execution-chart').getContext('2d');
                    new Chart(scriptCtx, {
                        type: 'bar',
                        data: {
                            labels: scriptNames,
                            datasets: [{
                                label: 'Script Executions',
                                data: scriptExecutions,
                                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                                borderColor: 'rgba(75, 192, 192, 1)',
                                borderWidth: 1
                            }]
                        },
                        options: {
                            indexAxis: 'y',
                            scales: {
                                y: {
                                    beginAtZero: true
                                }
                            }
                        }
                    });
                    
                    const groupCtx = document.getElementById('group-execution-chart').getContext('2d');
                    new Chart(groupCtx, {
                        type: 'bar',
                        data: {
                            labels: groupNames,
                            datasets: [{
                                label: 'Group Executions',
                                data: groupExecutions,
                                backgroundColor: 'rgba(153, 102, 255, 0.2)',
                                borderColor: 'rgba(153, 102, 255, 1)',
                                borderWidth: 1
                            }]
                        },
                        options: {
                            indexAxis: 'y',
                            scales: {
                                y: {
                                    beginAtZero: true
                                }
                            }
                        }
                    });
                </script>
            </div>
            <footer style="position: sticky; bottom: 0; left: 0; width: 100%; padding: 10px 0; text-align: center; border-top-left-radius: 20px; border-top-right-radius: 20px; background: linear-gradient(0deg, rgba(244, 244, 244, 1) 0%, rgba(244, 244, 244, 0) 100%); display: flex; justify-content: center;">
                <div class="bubble-footer"; style="display: flex; align-items: center;">
                    <a href="https://github.com/its4nik/screb" target="_blank" style="margin: 0 10px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                            <path fill="#000000" d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.21 11.387.6.111.793-.261.793-.577 0-.285-.012-1.04-.014-2.04-3.359.717-4.063-1.625-4.063-1.625-.548-1.387-1.336-1.756-1.336-1.756-1.092-.746.084-.731.084-.731 1.206.084 1.838 1.237 1.838 1.237 1.07 1.832 2.809 1.304 3.497.998.109-.776.42-1.304.764-1.604-2.675-.303-5.487-1.336-5.487-5.93 0-1.312.469-2.383 1.237-3.226-.135-.303-.537-1.523.104-3.176 0 0 1.008-.322 3.3 1.23.957-.267 1.982-.4 3-.405 1.016.005 2.041.138 2.998.405 2.29-1.552 3.297-1.23 3.297-1.23.643 1.653.239 2.873.117 3.176.77.843 1.236 1.914 1.236 3.226 0 4.606-2.816 5.622-5.489 5.918.43.37.823 1.101.823 2.223 0 1.605-.014 2.896-.014 3.287 0 .32.191.695.799.574C20.566 21.797 24 17.296 24 12c0-6.627-5.373-12-12-12z"/>
                        </svg>
                    </a>
                    <p> Made with </p>
                    <p>&nbsp;💖</p>
                    <p style="margin: 0 25px;">-</p>
                    <a href="/stats" style="margin: 0 5px;">
                        <p>Stats</p>
                    </a>
                    <a href="/logs" style="margin: 0 5px;">
                        <p>Logs</p>
                    </a>
                    <a href="/" style="margin: 0 5px;">
                        <p>Home</p>
                    </a>
                </div>
            </footer>
        </body>
    </html>
`;

    // Send HTML response
    res.send(configHtml);
});

// Serve the stats page as a subpage
app.get("/stats", (req, res) => {
    res.sendFile(path.join(__dirname, "stats.html"));
});


// Start the server
app.listen(PORT, () => {
    const timestamp = `${new Date().toISOString()}`;
    console.log(`[${timestamp}] Server running on port ${PORT}`);
    writeToLogFile("");
    writeToLogFile(`[${timestamp}] Server running on port ${PORT}`);
});
