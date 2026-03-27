const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');
const GOALS_FILE = path.join(__dirname, '..', 'goals.json');

let data = {};
let goals = {};

function ensureFile(filePath, defaultValue) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    }
}

function loadData() {
    try {
        ensureFile(DATA_FILE, {});
        ensureFile(GOALS_FILE, {});

        const rawData = fs.readFileSync(DATA_FILE, 'utf8');
        data = rawData ? JSON.parse(rawData) : {};

        const rawGoals = fs.readFileSync(GOALS_FILE, 'utf8');
        goals = rawGoals ? JSON.parse(rawGoals) : {};
    } catch (error) {
        console.error('Error loading storage files:', error);
        data = {};
        goals = {};
    }
}

async function saveData() {
    try {
        await fs.promises.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving data.json:', error);
    }
}

async function saveGoals() {
    try {
        await fs.promises.writeFile(GOALS_FILE, JSON.stringify(goals, null, 2));
    } catch (error) {
        console.error('Error saving goals.json:', error);
    }
}

function getUserData(userId) {
    if (!data[userId]) {
        data[userId] = {
            checkins: 0,
            sessions: 0,
            streak: 0,
            lastCheckin: 0,
            totalStudyMinutes: 0,
            completedSessions: 0,
            dailyStudy: {},
            createdAt: Date.now(),
            lastSessionAt: 0,
            privateVcId: null,
            awardedRoles: []
        };
    }
    return data[userId];
}

function getGoal(userId) {
    return goals[userId] || null;
}

function setGoal(userId, goalText) {
    goals[userId] = {
        goal: goalText,
        createdAt: Date.now(),
        lastReminder: 0
    };
    saveGoals();
    return goals[userId];
}

function clearGoal(userId) {
    delete goals[userId];
    saveGoals();
}

function getAllGoals() {
    return goals;
}

function formatMinutes(minutes) {
    if (!minutes || minutes <= 0) return '0m';
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

module.exports = {
    data,
    goals,
    loadData,
    saveData,
    saveGoals,
    getUserData,
    getGoal,
    setGoal,
    clearGoal,
    getAllGoals,
    formatMinutes
};
