module.exports = {
  siteMetadata: {
    title: 'Xposed Module Repository',
    siteUrl: 'https://modules.lsposed.org',
    description: 'New Xposed Module Repository',
    author: 'https://github.com/Xposed-Modules-Repo/modules/graphs/contributors'
  },
  plugins: [
    'gatsby-plugin-material-ui',
    'gatsby-plugin-postcss',
    'gatsby-plugin-stylus',
    'gatsby-plugin-react-helmet',
    'gatsby-plugin-sitemap',
    'gatsby-transformer-remark',
    {
      resolve: 'gatsby-plugin-nprogress',
      options: {
        color: '#ff5252',
        showSpinner: false
      }
    },
    {
      resolve: 'gatsby-source-filesystem',
      options: {
        name: 'pages',
        path: './src/pages/'
      },
      __key: 'pages'
    }
  ]
}
