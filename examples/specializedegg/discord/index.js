const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const dotenv = require('dotenv');
const WebSocket = require("ws");
dotenv.config();

console.log(process.env.EVENT_WS_URL)
const eventSocket = new WebSocket(process.env.EVENT_WS_URL);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		// Set a new item in the Collection with the key as the command name and the value as the exported module
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const command = interaction.client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	if(interaction.guildId !== "YOUR_SERVER") {
		await interaction.reply({ content: 'Sorry, bot is not allowed to execute commands in this server. '+interaction.guildId});
		return;
	}

	console.log(`Execution of ${interaction.commandName} requested by ${interaction.member.user.globalName} in ${interaction.guild.name}`);

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
		} else {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
		}
	}
});

eventSocket.once('open', () => {
	console.log("CVMAPI Events WebSocket connected!");
});

eventSocket.on('close', (e) => {
	process.exit(0);
});

eventSocket.on('error', (e) => {
	process.exit(0);
});


client.once(Events.ClientReady, c => {
	console.log(`Ready! Logged in as ${c.user.tag}`);
	const alertChannel = client.channels.cache.get("YOUR_CHANNEL_ID_HERE");
	eventSocket.on('message', async(e) => {
		var parsed = JSON.parse(e.toString());
		const alertEmbed = new EmbedBuilder()
            .setTitle("Message Flagged")
			.setAuthor({ name: parsed.vm })
            .addFields(
			{
                name: 'Reason(s)',
                value: parsed.description,
                inline: true
            },
			{
                name: 'Username',
                value: parsed.user,
                inline: true
            },
            {
                name: 'IP',
                value: parsed.ip,
                inline: true
            },
			{
                name: 'Message',
                value: parsed.message,
                inline: true
            },
	    {
 		name: 'Action Taken',
		value: parsed.action,
		inline: true
	    }
	    );
		await alertChannel.send({ embeds: [alertEmbed] });
	});
});

client.login(process.env.DISCORD_TOKEN);
