import fs from 'fs';
import csvParser from 'csv-parser';
import axios from 'axios';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const YOU_TRACK_URL = process.env.YOU_TRACK_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

if (!YOU_TRACK_URL || !AUTH_TOKEN) {
  throw new Error('Missing required environment variables: YOU_TRACK_URL or AUTH_TOKEN');
}

console.log(`Using YouTrack URL: ${YOU_TRACK_URL}`);

interface WorkItem {
  issueKey: string;
  text: string;
  date: number;
  durationSeconds: number;
}

const reportsDir = path.join(__dirname, 'reports');

function getLatestFile(directory: string): string | null {
  const files = fs.readdirSync(directory)
    .map(file => ({
      name: file,
      time: fs.statSync(path.join(directory, file)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  return files.length > 0 ? path.join(directory, files[0].name) : null;
}

const parseDuration = (duration: string): number => {
  const [hours, minutes, seconds] = duration.split(':').map(Number);
  return (hours * 3600) + (minutes * 60) + seconds;
};

const parseDate = (dateStr: string): number => {
  return new Date(dateStr).getTime();
};

const extractIssueKey = (description: string): string | null => {
  const match = description.match(/(\w+-\d+)/);
  return match ? match[1] : null;
};

const createWorkItems = async (workItems: WorkItem[]) => {
  const promises = workItems.map((workItem) => {
    return axios.post(
      `${YOU_TRACK_URL}/${workItem.issueKey}/timeTracking/workItems`,
      {
        usesMarkdown: true,
        text: workItem.text,
        date: workItem.date,
        duration: { seconds: workItem.durationSeconds },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
      })
      .then(response => {
        console.log(`Created workItem for ${workItem.issueKey}:`, response.data);
      })
      .catch(error => {
        console.error(`Failed to create workItem for ${workItem.issueKey}:`, error.response?.data || error.message);
      })
  });

  return Promise.all(promises);
};

const processCSV = async () => {
  const workItems: WorkItem[] = [];

  const latestFile = getLatestFile(reportsDir);
  if (!latestFile) {
    console.error('No report files found in the directory.');
    process.exit(1);
  }

  console.log(`Using file: ${latestFile}`);

  fs.createReadStream(latestFile)
    .pipe(csvParser())
    .on('data', (row) => {
      const issueKey = extractIssueKey(row.Description);
      if (!issueKey) throw new Error(`Cannot parse issue key. Please check row with the next description: "${row.Description}"`);

      const workItem: WorkItem = {
        issueKey,
        text: row.Description,
        date: parseDate(row['Start date']),
        durationSeconds: parseDuration(row.Duration),
      };
      workItems.push(workItem);
    })
    .on('end', async () => {
      await createWorkItems(workItems);
    });
};

processCSV();
