/*
 * TuxNG
 * by your average cat, ry00001
 * version "I have no idea what I'm doing"
 * builds: passing (probably at least)
 */

const Eris = require('eris')
const handler = require('./src/handler.js')
const crypto = require('crypto');
const fs = require('fs')
const superagent = require('superagent')
var config = {};
if (process.env.CI) { 
    config = {
        discord: {
            token: 'FAKE'
        },
        bot: {
            prefixes: ['FAKE'],
            owners: ['12345'],
            options: {}
        },
        dbots: {
            priority: ['1', '2'],
            token: 'abcdef'
        },
        dbl: {
            token: 'ghijkl'
        }
    }
} else if (process.env.DOCKER) {
    // running in Docker, do a thing!
    config = {
        discord: {
            token: process.env.TOKEN
        },
        bot: {
            prefixes: process.env.PREFIXES.split(' / '),
            owners: process.env.OWNERS.split(' '),
            options: {},
            redis_url: process.env.REDIS
        },
        dbots: {
            priority: process.env.DBOTS_PRIO.split(','),
            token: process.env.DBOTS_TOKEN
        }
    }
} else {
    config = require('./config.json')
}
const Redite = require('redite')
const util = require('util')
const bot = new handler.TuxNG(config.discord.token, process.env.CI, config.bot.prefixes, config.bot.options, config.bot.owners, config)

console.log('TuxNG starting...')

const postStats = () => {
    if (!bot.config.dbots.token) {
        console.log('No token found in configuration, skipping post.')
        return
    }
    superagent.post(`https://bots.discord.pw/api/bots/${bot.user.id}/stats`)
        .type('application/json')
        .set('Authorization', bot.config.dbots.token)
        .send({
            server_count: bot.guilds.size
        })
        .then(a => {
            console.log('Posted stats to bots.discord.pw successfully.')
        })
        .catch(a => {
            console.log(`ERROR while posting stats to bots.discord.pw: (${a.status}) ${a.response.body.error}\nThis can usually be safely ignored if you don't have a token or your bot isn't listed.`)
        })
}

const dumpPriority = () => {
    fs.open('./data/priority.dat', 'w', (err, fd) => {
        if (err) {
            console.log('Could not open priority file.')
            return;
        }
        if (!process.env.DBOTS_PRIO && !bot.config.dbots.priority) {
            console.log('[ERROR] DBOTS_PRIO environment variable not found and configuration key missing, ignoring...')
            return
        }
        let a = process.env.DBOTS_PRIO || bot.config.dbots.priority.join(',')
        fs.writeSync(fd, a.split(',').join('\n'))
    })
}

const run = () => {
    let ci = process.env.CI
    if (!ci) {
        let a = fs.statSync('./data')
        if (!a.isDirectory()) {
            console.log('data directory not detected, creating...')
            fs.mkdirSync('./data/')
        }
        if (!fs.existsSync('./data/priority.dat')) {
            console.log('Priority list file not found, creating and dumping priority list...')
            let a = process.env.DBOTS_PRIO || bot.config.dbots.priority
            if (typeof a === 'string') {
                a = a.split(',')
            }
            bot.priority = a
            dumpPriority();
        } else {
            console.log('Loading priority from .dat file.')
            let file = fs.readFileSync('./data/priority.dat').toString('utf8').split('\n')
            bot.priority = file
        }
    }
    if (ci) {
        console.log('Continuous Integration detected, loading all modules then exiting...');
        bot.loadDir(bot.options.commandsDir);
        process.exit(0);
    } else {
        bot.db = new Redite({url: config.bot.redis_url});
        bot.loadDir(bot.cmdOptions.commandsDir);
        bot.loadEvents(bot.cmdOptions.eventsDir);
        // hopefully fix the bork ^
        bot.connect();
    }
}

var currGame = 0;

var cycleGame = () => {
    let games = [
        {name: 'with hammers', type: 0},
        {name: 'for invites', type: 3},
        {name: 'the messages flow', type: 3},
        {name: 'the help command', type: 2},
        {name: 'with JavaScript', type: 0},
        {name: 'https://github.com/ClarityMoe/TuxNG', type: 0}
    ]
    currGame++;
    if (currGame >= games.length) currGame = 0;
    bot.editStatus('online', {name: games[currGame].name + ` | ${bot.prefixes[0]}help - ${bot.guilds.size} servers`, type: games[currGame].type})
}


var makeGuildInfo = g => {
    let defaults = {
        settings: {},
        punishments: [],
        modlog: []
    }
    let exists = bot.db[g.id].exists
    if (!exists) {
        bot.db[g.id].set(defaults) // hacky async closure hacks were here
        return;
    }
    bot.db[g.id].get.then(a => {
        if (!a) { 
            bot.db[g.id].set(defaults)
            return;
        } // what
        for (let i of Object.keys(defaults)) {
            if (!a[i] /* a[i] caramba */) {
                bot.db[g.id][i].set(defaults[i])
            }
        }
    })
}

var delGuildInfo = g => {
    console.log('Deleting information for guild ' + g.name)
    bot.db[g.id].set({})
}

bot.on('guildCreate', g => {
    postStats()
    makeGuildInfo(g)
    if (bot.config.bot.logging) {
        bot.createMessage(bot.config.bot.guild_channel, {
            embed: {
                title: `New guild: ${g.name} (${g.id})`,
                color: 0x00FF00,
                description: 'A new user has added Tuxedo to their guild.',
                thumbnail: {
                    url: g.iconURL
                },
                fields: [
                    {
                        name: 'Owned by',
                        value: bot.users.get(g.ownerID) ? `${bot.users.get(g.ownerID).username}#${bot.users.get(g.ownerID).discriminator}` : '???',
                        inline: false
                    },
                    {
                        name: 'Members',
                        value: `${g.members.size} (${g.members.filter(a => a.bot).length} bots)`,
                        inline: false
                    }
                ]
            }
        })
    }
})

bot.on('guildDelete', g => {
    postStats()
    delGuildInfo(g) // clean up after ourselves
    if (bot.config.bot.logging) {
        bot.createMessage(bot.config.bot.guild_channel, {
            embed: {
                title: `Lost guild: ${g.name} (${g.id})`,
                color: 0xFF0000,
                description: 'Somebody has removed Tuxedo from their guild.',
                thumbnail: {
                    url: g.iconURL
                },
                fields: [
                    {
                        name: 'Owned by',
                        value: bot.users.get(g.ownerID) ? `${bot.users.get(g.ownerID).username}#${bot.users.get(g.ownerID).discriminator}` : '???',
                        inline: false
                    },
                    {
                        name: 'Members',
                        value: `${g.members.size} (${g.members.filter(a => a.bot).length} bots)`,
                        inline: false
                    }
                ]
            }
        })
    }
})

bot.on('ready', () => {
    console.log(`Ready, connected as ${bot.user.username}#${bot.user.discriminator} (${bot.user.id})`)
    if (!bot.bot) {
        console.log('TuxNG can only be ran under bot accounts. Exiting...')
        process.exit(1);
    }

    bot.db.strikes.exists().then(r => {
        if (!r) {
            bot.db.strikes.set({})
        }
    })

    for (let guild of bot.guilds) {
        makeGuildInfo(guild[1]) // [1] is required because lol collections.
    }

    postStats();
    cycleGame();
    setInterval(() => cycleGame(), 120000)
})

bot.cmdEvent('commandError', async (ctx, err) => {
    let errcode = crypto.randomBytes(10).toString('hex')
    let etext = `\`\`\`${err.stack}\`\`\``
    if (etext.length > 2000) {
        superagent.post('https://hastebin.com/documents')
            .type('text/plain')
            .send(err.stack)
            .then(a => {
                etext = `[Error too long to display nicely](https://hastebin.com/${a.body.key})`
            })
    }
    await ctx.send({
        embed: {
            title: 'Command error',
            description: `Well, this is embarrassing. 
It appears an error has happened in Tuxedo's source code.
This isn't your fault, but you may want to report this at [${ctx.bot.config.bot.support_text}](${ctx.bot.config.bot.support}). Be sure to quote the error code!`,
            fields: [{
                name: 'Error details',
                value: `\`\`\`${err}\`\`\``,
                inline: false
            },
            {
                name: 'Error code',
                value: errcode,
                inline: false
            }]
        }
    })
    ctx.bot.createMessage(ctx.bot.config.bot.error_channel, {
        embed: {
            title: `Command error in \`${ctx.command.name}\``,
            description: 'Error occurred while processing command',
            fields: [{
                name: 'Error details (stacktrace)',
                value: etext,
                inline: false
            },
            {
                name: 'Error code',
                value: errcode,
                inline: false
            }]
        }
    })
})

bot.cmdEvent('commandNoDM', async ctx => {
    await ctx.send(':x: | This command cannot be used in Direct Messages.')
})

bot.cmdEvent('commandNotOwner', async ctx => { 
    let msgs = ['...Nope.',
        'Nice try, but did you really think I\'d let you?',
        'Why even bother trying? Not like I\'ll let you.']
    await ctx.send(msgs[Math.floor(Math.random() * msgs.length)])
})

bot.cmdEvent('commandNoPermissions', async ctx => {
    await ctx.send(':no_entry_sign: | Invalid permissions.')
})

bot.cmdEvent('commandBotNoPermissions', async ctx => {
    await ctx.send(':no_entry_sign: | The bot doesn\'t have enough permissions to run this.')
})

run();