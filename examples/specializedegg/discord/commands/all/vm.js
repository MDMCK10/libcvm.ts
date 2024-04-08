const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

function parseTurnQueue(users) {
	let list = [];
	list.push(`🔵 ${users[0].username}`);
	users.shift();
	users.forEach(user => {
		list.push(`🟡 ${user.username}\n`);
	});
	return list.join("\n");
}

function parseVoteInfo(status) {
	return `⏳ Time left: ${status.time / 1000} seconds\n✅ Yes: ${status.yes}\n❌ No: ${status.no}`
}

function parseUserList(users) {
	let list = "";
	users.forEach(user => {
		switch(user.rank) {
			case 0: {
				list += `${user.username}\n`;
				break;
			};
			
			case 2: {
				list += `🔴 ${user.username}\n`;
				break;
			};
			
			case 3: {
				list += `🟢 ${user.username}\n`;
				break;
			};
		}
	})
	return list;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('vm')
		.setDescription('Get info from a VM')
		.addStringOption(option =>
			option.setName('vm')
				  .setDescription('VM to get info from')
				  .setRequired(true)
				  .addChoices(
					{ name: 'VM0', value: 'vm0b0t' },
					{ name: 'VM1', value: 'vm1' },
					{ name: 'VM2', value: 'vm2' },
					{ name: 'VM3', value: 'vm3' },
					{ name: 'VM4', value: 'vm4' },
					{ name: 'VM5', value: 'vm5' },
					{ name: 'VM6', value: 'vm6' },
					{ name: 'VM7', value: 'vm7' },
					{ name: 'VM8', value: 'vm8' })),
	async execute(interaction) {
		await interaction.deferReply();
		const vm = interaction.options.getString('vm');
		const vminfo = await axios.get(`${process.env.API_URL}/vminfo/${vm}`, {
			validateStatus: () => true
		});
		
		if(vminfo.data.status === "error") {
			return await interaction.editReply(vminfo.data.message);
		};

		const screenshot = await axios.get(`${process.env.API_URL}/screenshot/${vm}`, {
			responseType: 'arraybuffer',
			validateStatus: () => true
		});

		const file = new AttachmentBuilder(screenshot.data, {
			name: `${vm}.png`,
			description: `A screenshot of VM "${vm}".`
		});
		
		const embed = new EmbedBuilder()
			.setTitle(vm.toUpperCase())
			.addFields({
				name: 'Users',
				value: parseUserList(vminfo.data.message.users),
				inline: true
			})
			.setImage(`attachment://${vm}.png`);
			
		if(vminfo.data.message.turnqueue !== null) {
			embed.addFields({
				name: 'Turn Queue',
				value: parseTurnQueue(vminfo.data.message.turnqueue),
				inline: true
			})
		}
		
		if(vminfo.data.message.voteinfo !== null) {
			embed.addFields({
				name: 'Vote Info',
				value: parseVoteInfo(vminfo.data.message.voteinfo),
				inline: true
			})
		}
		
		await interaction.editReply({ embeds: [embed], files: [file] });
	},
};
