class TimeUtils {
    static getNextNewday() {
        const now = new Date();
        const nyTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
        
        const nextNewday = new Date(nyTime);
        nextNewday.setHours(6, 0, 0, 0); // Changed from 5 AM to 6 AM EST
        
        if (nyTime.getHours() >= 6) { // Changed from 5 to 6
            nextNewday.setDate(nextNewday.getDate() + 1);
        }

        const offset = now.getTime() - nyTime.getTime();
        return new Date(nextNewday.getTime() + offset);
    }

    static willFallNextNewday(lastOnline) {
        const now = new Date();
        const daysSinceLogin = Math.floor((now - lastOnline) / (24 * 60 * 60 * 1000));
        return daysSinceLogin >= 41;
    }

    static calculateDaysUntilPurge(lastOnline) {
        if (this.willFallNextNewday(lastOnline)) {
            return 0;
        }
        
        const now = new Date();
        const daysSinceLogin = Math.floor((now - lastOnline) / (24 * 60 * 60 * 1000));
        return Math.max(0, 42 - daysSinceLogin);
    }
}

module.exports = TimeUtils;