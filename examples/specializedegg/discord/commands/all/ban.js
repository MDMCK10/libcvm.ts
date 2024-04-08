const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ban')
		.setDescription('Ban a user')
        .addStringOption(option =>
			option.setName('username')
				  .setDescription('User to ban')
				  .setRequired(true))
		.addStringOption(option =>
			option.setName('vm')
				  .setDescription('VM to ban from')
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
					{ name: 'VM8', value: 'vm8' }))
		.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
	async execute(interaction) {
		await interaction.deferReply();
		const vm = interaction.options.getString('vm');
		const username = interaction.options.getString('username');
		const response = await axios.get(`${process.env.API_URL}/mod/ban/${vm}/${username}?token=${process.env.API_TOKEN}`, {
			validateStatus: () => true
		});
		
		await interaction.editReply(response.data.message);
	},
};
