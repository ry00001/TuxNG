/**
 * TuxNG Command handler
 * @author ry00001
 */

const Eris = require('eris');
const fs = require('fs');
const path = require('path')

class TuxNG extends Eris.Client {
    constructor(token, isCI = false, prefixes = [], cmdOptions = {}, owners = [], config = {}) {
        super(`Bot ${token}`, {restMode: true});
        this.commands = [];
        this.isCI = isCI;
        if (!isCI) { 
            this.eventHooks = [];
            this.cevents = {};
            this.config = config;
            this.prefixes = prefixes;
            this.cmdOptions = cmdOptions;
            this.owners = owners;

            this.on('ready', () => {
                // Housekeeping
                if (!this.cmdOptions.noMentionPrefix) {
                    this.prefixes.push(`<@${this.user.id}> `, `<@!${this.user.id}> `);
                }
                if (this.owners === []) {
                    console.warn('No owners registered. Nobody will be able to use owner commands such as eval. The second-to-last argument of the bot constructor is the owners.')
                }
                if (this.prefixes === [] && this.cmdOptions.noMentionPrefix) {
                    console.warn('Warning! The bot has no prefixes registered, and you have chosen to disable mention prefixes! Please add some prefixes or enable mention prefixes, as the bot will be un-triggerable until you do!')
                }
            })

            this.on('messageCreate', m => {
                if (m.author.bot) return;
                let prefix = undefined;
                this.prefixes.forEach(i => {if (m.content.startsWith(i)) { prefix = i }})
                if (prefix === undefined) {
                // no prefix found; drop the message
                    return;
                }
                let text = m.content.slice(prefix.length).split(' ')
                let cmdName = text.shift()
                let cmd = this.findCommand(cmdName)
                let ctx = new Context(this, m, cmd)
                if (cmd === undefined) {
                // invalid command; drop it again - but fire an event
                    this.cmdDispatch('commandInvalid', [ctx])
                    return;
                }
                if (cmd.ownerOnly && !this.owners.includes(ctx.author.id)) {
                    this.cmdDispatch('commandNotOwner', [ctx])
                    return;
                }
                if (ctx.isDM && !cmd.dmable) {
                    this.cmdDispatch('commandNoDM', [ctx])
                    return
                }
                if (!ctx.isDM) {
                    if (!cmd.botAble(ctx.me)) {
                        this.cmdDispatch('commandBotNoPermissions', [ctx])
                        return;
                    }
                    if (!cmd.able(this, ctx.member)) {
                        this.cmdDispatch('commandNoPermissions', [ctx])
                        return;
                    }
                }
                // fire the command!
                try {
                    cmd.code(ctx, text).catch(e => {
                        this.cmdDispatch('commandError', [ctx, e])
                    })
                } catch(e) { // failsafe in case it's not async because I am kind of an idiot and forget sometimes
                    this.cmdDispatch('commandError', [ctx, e])
                }
            })
        }
    }

    loadCommand(cmdObj) {
        let cmd = new Command(cmdObj)
        if (!this.commands.includes(cmd)) this.commands.push(cmd);
    }

    loadEvent(evtObj) {
        for (let j of evtObj.events) {
            if (evtObj.isHandler) {
                this.cmdEvent(j, evtObj.code)
            } else {
                this.on(j, (...args) => { args.unshift(this); evtObj.code(...args) })
            }
        }
    }

    findCommand(name) {
        return this.commands.find(a => a.name === name || a.aliases.includes(name))
    }

    cmdEvent(name, code) {
        if (this.isCI) return;
        if (this.cevents[name] === undefined) {
            this.cevents[name] = []
        }
        this.cevents[name].push(code)
    }

    cmdDispatch(name, args) {
        if (!this.cevents[name]) return;
        this.cevents[name].forEach(i => i(...args).catch(j => console.error(`Error in event ${name}: ${j.stack}`)))
    }

    loadDir(commandsDir = './commands/') {
        fs.readdir(commandsDir, (e, files) => {
            files.forEach(a => {
                let c = require(path.resolve(commandsDir + a))
                if (this.cmdOptions.verbose) console.log(`Adding ${c.name}`)
                this.loadCommand(c)
            })
        })
    }

    loadEvents(dir = './events') {
        fs.readdir(dir, (e, files) => {
            files.forEach(a => {
                let c = require(path.resolve(dir + '/' + a))
                if (this.cmdOptions.verbose) console.log(`Adding event ${c.name}`)
                this.loadEvent(c)
            })
        })
    }

    parseMention(mention, guild) {
        let match = mention.match(/<@!?(\d+)>/)
        if (!match) return undefined
        if (guild === undefined) {
            return this.users.get(match[1])
        } else {
            return guild.members.get(match[1])
        }
    }

    parseUser(str, guild) {
        let m = this.parseMention(str, guild)
        if (m) return m
        let thing = guild ? guild.members : this.users
        m = thing.get(str)
        if (m) return m
        m = thing.find(a => a.username === str)
        if (m) return m
        m = thing.find(a => `${a.username}#${a.discriminator}` === str)
        if (m) return m
        return undefined
    }

    async addStrike(user, count=1, reason) {
        if (!await this.db.strikes.exists()) {
            await this.db.strikes.set({})
        }
        if (!await this.db.strikes[user.id].exists()) {
            await this.db.strikes[user.id].set({})
            await this.db.strikes[user.guild.id].set(0)
        }
        this.db.strikes[user.id][user.guild.id].get.then(a => {
            a += count
            this.db.strikes[user.id][user.guild.id].set(a)
            this.cmdDispatch('strikeAdd', [this, 'add', user, count, reason])
        }).catch(() => {
            let currStrikes = count;
            this.db.strikes[user.id][user.guild.id].set(currStrikes)
            this.cmdDispatch('strikeAdd', [this, 'add', user, count, reason])
        })
    }

    async removeStrike(user, count=1) {
        if (!await this.db.strikes.exists()) {
            await this.db.strikes.set({})
        }
        if (!await this.db.strikes[user.id].exists()) {
            await this.db.strikes[user.id].set({})
            await this.db.strikes[user.guild.id].set({})
        }
        this.db.strikes[user.id][user.guild.id].get.then(a => {
            a -= count
            this.db.strikes[user.id][user.guild.id].set(a)
            this.cmdDispatch('strikeAdd', [this, 'add', user, count])
        }).catch(() => {})
    }

    async getStrikes(user) {
        if (!await this.db.strikes[user.id].exists() || !await this.db.strikes[user.id][user.guild.id].exists()) {
            return 0;
        }
        let strikes = await this.db.strikes[user.id][user.guild.id].get;
        if (strikes === undefined) {
            return 0;
        } else {
            return strikes;
        }
    }

    async setStrikes(user, count) {
        await this.db.strikes[user.id][user.guild.id].set(count);
        this.cmdDispatch('strikeSet', [this, 'set', user, count])
    }

    isOwner(user) {
        return this.owners.includes(user.id)
    }
}

class Command {
    constructor(cmdObj) {
        /* this.name = name
        this.code = code
        this.description = desc
        this.perms = perms
        this.botPerms = botPerms
        this.ownerOnly = owner
        this.aliases = aliases
        this.hidden = hidden
        this.dmable = dmable */
        let defaults = {
            name: 'placeholder',
            code: () => {},
            description: 'placeholder',
            perms: [],
            botPerms: [],
            ownerOnly: false,
            aliases: [],
            hidden: false,
            dmable: true
        }
        for (let i of Object.keys(defaults)) {
            this[i] = cmdObj[i] || defaults[i]
        }
    }

    able(bot, member) {
        if (bot.owners.includes(member.id)) {
            return true;
        }

        if (member.guild.ownerID === member.id) {
            return true; // since permission.has doesn't take in account guild ownership...
        }
        if (member.permission.has('administrator')) {
            return true;
        }
        return this.perms.every(i => member.permission.has(i));
    }

    botAble(me) {
        if (me.guild.ownerID === me.id) {
            return true; // since permission.has doesn't take in account guild ownership...
        }
        if (me.permission.has('administrator')) {
            return true;
        }
        return this.botPerms.every(i => me.permission.has(i));
    }
}

class Context {
    constructor(bot, msg, cmd) {
        this.author = msg.author
        this.channel = msg.channel
        this.guild = msg.channel.guild
        this.message = msg
        this.command = cmd
        if (msg.channel.guild) {
            this.me = msg.channel.guild.members.get(bot.user.id);
            this.member = msg.member
            this.isDM = false
        } else {
            this.isDM = true
        }
        this.bot = bot
    }

    async send(content, file) {
        return await this.bot.createMessage(this.channel.id, content, file)
    }
}

module.exports = {TuxNG, Command, Context} // Tuxedo