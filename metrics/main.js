/**
 * This script runs Google Lighthouse on the specified url RUNS times,
 * or the specified number of times if given. The numerical results are
 * written to a csv.
 */
const lighthouse = require('lighthouse');
const minimist = require('minimist');
const fs = require('fs');
const chromeHarCapturer = require('chrome-har-capturer');
const percentile = require('percentile');

/**
 * Chrome port. When testing on android, you'll want to change this
 * to the port used by the Android ADB TCP forwarding
 */
const PORT = 8041;

/**
 * Default file name
 */
const FILE = 'result.csv';

/**
 * Lighthouse config options
 */
const OPTS = {
  port: PORT,
  disableStorageReset: true,
  emulatedFormFactor: 'desktop',
  onlyCategories: ['performance'],
};

/**
 * Number of Lighthouse runs
 */
const RUNS = 30;

/**
 * This the header of the .csv file, including all metrics that are measured
 */
const METRIC_HEADERS =
  'first-contentful-paint,first-meaningful-paint,speed-index,total-blocking-time,estimated-input-latency,time-to-first-byte,first-cpu-idle,time-to-interactive,network-rtt,network-requests,dom-size,total-transfer-size,average-transfer-size,median-transfer-size,90th-percentile-transfer-size,95th-percentile-transfer-size,99th-percentile-transfer-size,average-transfer-time,median-transfer-time,90th-percentile-transfer-time,95th-percentile-transfer-time,99th-percentile-transfer-time,number-api-calls,lowest-time-to-widget,median-time-to-widget\n';

function avg(list) {
  if (list.length == 0) {
    return 0;
  }

  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += list[i];
  }

  return total / list.length;
}

function median(list) {
  if (list.length == 0) {
    return 0;
  }

  const half = Math.floor(list.length / 2);

  list.sort(function (a, b) {
    return a - b;
  });

  if (list.length % 2) {
    return list[half];
  }

  return (list[half - 1] + list[half]) / 2.0;
}

async function runLighthouse(url) {
  return lighthouse(url, OPTS, null).then((results) => {
    return results;
  });
}

/**
 * Retrieves the time to widget with the lowest timestamp
 * @param {*} userTimings
 */
function getLowestTimeToWidget(userTimings) {
  let lowestTime = -1;
  const items = userTimings['items'];
  for (item in items) {
    if (items[item]['name'] === 'time-to-widget') {
      const timestamp = items[item]['startTime'];
      if (lowestTime === -1 || timestamp < lowestTime) {
        lowestTime = timestamp;
      }
    }
  }
  return lowestTime;
}

function getMedianTimeToWidget(userTimings) {
  let times = [];
  const items = userTimings['items'];
  for (item in items) {
    if (items[item]['name'] === 'time-to-widget') {
      const timestamp = items[item]['startTime'];
      times.push(timestamp);
    }
  }
  return median(times);
}

/**
 * Runs Google Lighthouse on the given url and writes metrics to the given
 * file stream
 *
 * @param url the url of the web page to test
 * @param writeStream file stream of the file to write to
 */
async function doTest(url, writeStream) {
  const results = await runLighthouse(url);
  const rawData = results.lhr;
  const userTimings = rawData.audits['user-timings']['details'];

  const logs = results.artifacts['devtoolsLogs']['defaultPass'];
  const harResult = await chromeHarCapturer.fromLog(url, logs);
  const harEntries = harResult['log']['entries'];

  let totaltransfersize = 0;
  let transfersizes = [];
  let times = [];
  for (entry in harEntries) {
    let time = 0;
    const request = harEntries[entry];
    const response = request['response'];
    const transfersize = response['_transferSize'];

    const timings = request['timings'];

    // add up all the timing components to get the request time
    for (key in request['timings']) {
      // null values are -1, we do not want those
      if (timings[key] >= 0) {
        time += timings[key];
      }
    }

    times.push(time);
    totaltransfersize += transfersize;
    transfersizes.push(transfersize);
  }

  const metrics = [
    rawData.audits['first-contentful-paint'].numericValue,
    rawData.audits['first-meaningful-paint'].numericValue,
    rawData.audits['speed-index'].numericValue,
    rawData.audits['total-blocking-time'].numericValue,
    rawData.audits['estimated-input-latency'].numericValue,
    rawData.audits['time-to-first-byte'].numericValue,
    rawData.audits['first-cpu-idle'].numericValue,
    rawData.audits['interactive'].numericValue,
    rawData.audits['network-rtt'].numericValue,
    rawData.audits['network-requests'].numericValue,
    rawData.audits['dom-size'].numericValue,
    totaltransfersize,
    avg(transfersizes),
    median(transfersizes),
    percentile(90, transfersizes),
    percentile(95, transfersizes),
    percentile(99, transfersizes),
    avg(times),
    median(times),
    percentile(90, times),
    percentile(95, times),
    percentile(99, times),
    times.length,
    getLowestTimeToWidget(userTimings),
    getMedianTimeToWidget(userTimings),
  ];

  let line = metrics.join(',');
  line += '\n';

  writeStream.write(line);
}

/**
 * Creates the file path for the .csv file
 * @param file file name of the .csv, including extension
 * @param folder folder to place the file
 */
function createFileName(file, folder) {
  if (!file) {
    file = FILE;
  }

  try {
    let i = 2;
    while (fs.existsSync(folder + file)) {
      console.log(`${file} already exists! Appending ${i}`);

      // result.csv -> result2.csv
      var index = file.indexOf('.');
      file = file.slice(0, index) + i + file.slice(index, file.length);

      i++;
    }
  } catch (err) {
    console.error(err);
  }
  return folder + file;
}

function help() {
  console.error(
    'How to use this script:\n\n--url: the url to test\n--file: where to save the csv. If not provided, result.csv is used.\n--folder: folder to save the file in. By default, the current folder is used. \n--runs: The number of runs to perform\n\n'
  );
  process.exit(1);
}

async function main() {
  const args = minimist(process.argv.slice(2));

  if (!args.url) {
    help();
  }

  let runs = args.runs;
  if (!args.runs) {
    runs = RUNS;
  }

  let folder = args.folder;
  if (!args.folder) {
    folder = '';
  }

  const file = createFileName(args.file, folder);
  const writeStream = fs.createWriteStream(file, { flags: 'a' });

  writeStream.write(METRIC_HEADERS);

  // Do a single warmup run in case the HTTP server needs to warm up
  // This can be an issue when running on localhost
  await runLighthouse(args.url);

  for (let i = 0; i < runs; i++) {
    console.log('Running test ' + (i + 1));
    await doTest(args.url, writeStream).catch((e) => console.log(e));
  }

  writeStream.close();
  console.log('Successfully written to file: ' + file);

  process.exit();
}

if (require.main === module) {
  main();
}
