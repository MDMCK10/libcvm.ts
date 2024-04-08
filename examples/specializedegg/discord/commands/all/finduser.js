const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('finduser')
		.setDescription('Find a user on all VMs')
		.addStringOption(option =>
			option.setName('username')
				  .setDescription('Username to find')
				  .setRequired(true)),
	async execute(interaction) {
		await interaction.deferReply();
		const user = interaction.options.getString('username');
		const userinfo = await axios.get(`${process.env.API_URL}/finduser/${user}`, {
			validateStatus: () => true
		});
		
		if(userinfo.data.status === "error") {
			return await interaction.editReply(userinfo.data.message);
		};
		
		await interaction.editReply(`User ${user} found on ${userinfo.data.message.vms.join(", ").toUpperCase()}.`);
	},
};
