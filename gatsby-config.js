module.exports = {
  siteMetadata: {
    title: 'modules',
    siteUrl: 'https://modules.lsposed.workers.dev'
  },
  plugins: [
    'gatsby-plugin-postcss',
    'gatsby-plugin-react-helmet',
    'gatsby-plugin-sitemap',
    'gatsby-transformer-remark',
    {
      resolve: 'gatsby-source-filesystem',
      options: {
        name: 'pages',
        path: './src/pages/'
      },
      __key: 'pages'
    },
    {
      resolve: 'gatsby-source-github-api-xposed-modules',
      options: {
        token: process.env.GRAPHQL_TOKEN
      }
    }
  ]
}
