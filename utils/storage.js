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

function createUserBase() {
    return {
        checkins: 0,
        sessions: 0,
        streak: 0,
        lastCheckin: 0,
        totalStudyMinutes: 0,
        completedSessions: 0,
        dailyStudy: {},
        createdAt: Date.now(),
        lastSessionAt: 0,
        privateCategoryId: null,
        privateVcId: null,
        privateTextId: null,
        privateCategoryCreatedAt: 0,
        privateCategoryLastActive: 0,
        awardedRoles: [],
        tasks: [],
        reminders: []
    };
}

function getUserData(userId) {
    if (!data[userId]) {
        data[userId] = createUserBase();
    }

    const userData = data[userId];

    if (!userData.tasks) userData.tasks = [];
    if (!userData.reminders) userData.reminders = [];
    if (!userData.dailyStudy) userData.dailyStudy = {};
    if (!userData.createdAt) userData.createdAt = Date.now();
    if (!userData.awardedRoles) userData.awardedRoles = [];
    if (!userData.privateCategoryId) userData.privateCategoryId = null;
    if (!userData.privateVcId) userData.privateVcId = null;
    if (!userData.privateTextId) userData.privateTextId = null;
    if (!userData.privateCategoryCreatedAt) userData.privateCategoryCreatedAt = 0;
    if (!userData.privateCategoryLastActive) userData.privateCategoryLastActive = 0;

    return userData;
}

function getGoal(userId) {
    return goals[userId] || null;
}

function setGoal(userId, goalData) {
    goals[userId] = {
        goal: typeof goalData === 'string' ? goalData : goalData.goal,
        description: goalData.description || null,
        dueDate: goalData.dueDate || null,
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

function addTask(userId, task) {
    const userData = getUserData(userId);
    const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const entry = {
        id,
        title: task.title,
        description: task.description || null,
        dueDate: task.dueDate || null,
        completed: false,
        createdAt: Date.now()
    };
    userData.tasks.push(entry);
    saveData();
    return entry;
}

function getTask(userId, taskId) {
    const userData = getUserData(userId);
    return userData.tasks.find(task => task.id === taskId) || null;
}

function updateTask(userId, taskId, updates) {
    const task = getTask(userId, taskId);
    if (!task) return null;
    if (typeof updates.title === 'string') task.title = updates.title;
    if (typeof updates.description === 'string') task.description = updates.description;
    if (typeof updates.dueDate !== 'undefined') task.dueDate = updates.dueDate;
    if (typeof updates.completed === 'boolean') task.completed = updates.completed;
    saveData();
    return task;
}

function removeTask(userId, taskId) {
    const userData = getUserData(userId);
    const index = userData.tasks.findIndex(task => task.id === taskId);
    if (index === -1) return false;
    userData.tasks.splice(index, 1);
    saveData();
    return true;
}

function listTasks(userId) {
    const userData = getUserData(userId);
    return userData.tasks;
}

function addReminder(userId, reminder) {
    const userData = getUserData(userId);
    const id = `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const entry = {
        id,
        text: reminder.text,
        dueAt: reminder.dueAt,
        createdAt: Date.now(),
        delivered: false
    };
    userData.reminders.push(entry);
    saveData();
    return entry;
}

function getReminder(userId, reminderId) {
    const userData = getUserData(userId);
    return userData.reminders.find(reminder => reminder.id === reminderId) || null;
}

function removeReminder(userId, reminderId) {
    const userData = getUserData(userId);
    const index = userData.reminders.findIndex(reminder => reminder.id === reminderId);
    if (index === -1) return false;
    userData.reminders.splice(index, 1);
    saveData();
    return true;
}

function listReminders(userId) {
    const userData = getUserData(userId);
    return userData.reminders;
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
    addTask,
    getTask,
    updateTask,
    removeTask,
    listTasks,
    addReminder,
    getReminder,
    removeReminder,
    listReminders,
    formatMinutes
};
