const modlog = require('../src/modlog.js')

module.exports = {
    events: ['guildBanRemove'],
    code: async (bot, g, m) => {
        let log;
        try {
            log = await g.getAuditLogs(1)
        } catch(e) {
            return;
        }
        let user = log.entries[0].targetID;
        if (user !== m.id) {
            return; // it was THE WRONG THING
        }
        let gdb = await bot.db[g.id].get;
        let modlogs = await bot.db[g.id].modlogs.get || [];
        let settings = await bot.db[g.id].settings.get;
        if (!settings.modlog_channel) return; // no modlog channel?
        let channel = g.channels.get(settings.modlog_channel)
        if (!channel) return; // channel delet?
        let newestCase = modlogs.length + 1
        let entry = new modlog.ModLogEntry(newestCase, log.entries[0], log)
        let msg = await channel.createMessage({embed: entry.toEmbed()})
        modlogs.push({
            entry: entry.toObject(),
            msgId: msg.id,
            channelId: channel.id
        })
        await bot.db[g.id].modlog.set(modlogs)
    }
}