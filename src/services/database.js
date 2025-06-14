// src/services/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        // Ensure data directory exists
        const dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.dbPath = path.join(dataDir, 'statistics.db');
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err);
            } else {
                console.log('Connected to SQLite database at:', this.dbPath);
            }
        });
        this.initTables();
    }

    initTables() {
        const createTable = `
            CREATE TABLE IF NOT EXISTS nation_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nation_name TEXT NOT NULL,
                nation_uuid TEXT,
                date DATE NOT NULL,
                residents INTEGER,
                chunks INTEGER,
                towns INTEGER,
                bank_balance REAL,
                capital_name TEXT,
                leader_name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(nation_name, date)
            )
        `;
        
        const createIndex = `
            CREATE INDEX IF NOT EXISTS idx_nation_date 
            ON nation_snapshots(nation_name, date)
        `;

        const createUuidIndex = `
            CREATE INDEX IF NOT EXISTS idx_nation_uuid 
            ON nation_snapshots(nation_uuid)
        `;

        this.db.serialize(() => {
            this.db.run(createTable, (err) => {
                if (err) console.error('Error creating table:', err);
            });
            this.db.run(createIndex, (err) => {
                if (err) console.error('Error creating index:', err);
            });
            this.db.run(createUuidIndex, (err) => {
                if (err) console.error('Error creating UUID index:', err);
            });
        });
    }

    async saveNationSnapshot(nationData) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT OR REPLACE INTO nation_snapshots 
                (nation_name, nation_uuid, date, residents, chunks, towns, bank_balance, capital_name, leader_name)
                VALUES (?, ?, date('now'), ?, ?, ?, ?, ?, ?)
            `;
            
            this.db.run(query, [
                nationData.name,
                nationData.uuid,
                nationData.stats.numResidents,
                nationData.stats.numTownBlocks,
                nationData.towns.length,
                nationData.stats.balance || 0,
                nationData.capital?.name || null,
                nationData.king?.name || null
            ], function(err) {
                if (err) {
                    console.error('Error saving nation snapshot:', err);
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }

    async getNationHistory(nationName, days = 30) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM nation_snapshots 
                WHERE LOWER(nation_name) = LOWER(?) 
                AND date >= date('now', '-' || ? || ' days')
                ORDER BY date ASC
            `;
            
            this.db.all(query, [nationName, days], (err, rows) => {
                if (err) {
                    console.error('Error getting nation history:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getAllNationsWithData() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT DISTINCT nation_name, COUNT(*) as data_points
                FROM nation_snapshots 
                GROUP BY nation_name
                ORDER BY nation_name
            `;
            
            this.db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error getting nations with data:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getDataRange(nationName) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    MIN(date) as first_date,
                    MAX(date) as last_date,
                    COUNT(*) as total_days
                FROM nation_snapshots 
                WHERE LOWER(nation_name) = LOWER(?)
            `;
            
            this.db.get(query, [nationName], (err, row) => {
                if (err) {
                    console.error('Error getting data range:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async getTotalDataPoints() {
        return new Promise((resolve, reject) => {
            const query = `SELECT COUNT(*) as total FROM nation_snapshots`;
            
            this.db.get(query, [], (err, row) => {
                if (err) {
                    console.error('Error getting total data points:', err);
                    reject(err);
                } else {
                    resolve(row.total);
                }
            });
        });
    }

    async getRecentActivity(days = 7) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT date, COUNT(*) as nations_collected
                FROM nation_snapshots 
                WHERE date >= date('now', '-' || ? || ' days')
                GROUP BY date
                ORDER BY date DESC
            `;
            
            this.db.all(query, [days], (err, rows) => {
                if (err) {
                    console.error('Error getting recent activity:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    close() {
        return new Promise((resolve) => {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                } else {
                    console.log('Database connection closed');
                }
                resolve();
            });
        });
    }
}

module.exports = Database;