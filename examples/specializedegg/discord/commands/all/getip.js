const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('getip')
		.setDescription('Get the IP address of a user')
		.addStringOption(option =>
			option.setName('username')
				  .setDescription('Username to grab IP from')
				  .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
	async execute(interaction) {
		await interaction.deferReply();
		const user = interaction.options.getString('username');
		const ipinfo = await axios.get(`${process.env.API_URL}/mod/getip/${user}?token=${process.env.API_TOKEN}`, {
			validateStatus: () => true
		});
		
		if(ipinfo.data.status === "error") {
			return await interaction.editReply(ipinfo.data.message);
		};
		
        let embeds = [];

        for(const vm of ipinfo.data.message) {
            const embed = new EmbedBuilder()
            .setTitle(vm.vm.toUpperCase())
            .addFields({
                name: 'Username',
                value: user,
                inline: true
            },
            {
                name: 'IP',
                value: vm.ip,
                inline: true
            });

            embeds.push(embed);
        }
			
		await interaction.editReply({ embeds: embeds });
	},
};
