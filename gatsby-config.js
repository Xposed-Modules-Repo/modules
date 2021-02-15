const flexsearchConfig = require('./src/flexsearch-config')

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
    {
      resolve: 'gatsby-transformer-remark',
      options: {
        plugins: [
          'gatsby-remark-external-links'
        ]
      }
    },
    {
      resolve: 'gatsby-plugin-local-search',
      options: {
        name: 'repositories',
        engine: 'flexsearch',
        engineOptions: flexsearchConfig,
        query: `
{
  allGithubRepository(filter: {isModule: {eq: true}, hide: {eq: false}}) {
    edges {
      node {
        name
        description
        collaborators {
          edges {
            node {
              login
              name
            }
          }
        }
        releases {
          edges {
            node {
              description
            }
          }
        }
        readme
        childGitHubReadme {
          childMarkdownRemark {
            excerpt(pruneLength: 250, truncate: true)
          }
        }
        summary
        additionalAuthors {
          name
        }
      }
    }
  }
}
        `,
        ref: 'name',
        index: ['name', 'description', 'summary', 'readme', 'collaborators', 'additionalAuthors', 'release'],
        store: ['name', 'description', 'summary', 'readmeExcerpt'],
        normalizer: ({ data }) =>
          data.allGithubRepository.edges.map(({ node: repo }) => ({
            name: repo.name,
            description: repo.description,
            summary: repo.summary,
            readme: repo.readme,
            readmeExcerpt: repo.childGitHubReadme && repo.childGitHubReadme.childMarkdownRemark.excerpt,
            release: repo.releases && repo.releases.edges.length &&
              repo.releases.edges[0].node.description,
            collaborators: repo.collaborators &&
              repo.collaborators.edges.map(({ node: collaborator }) => `${collaborator.name} (@${collaborator.login})`)
                .join(', '),
            additionalAuthors: repo.additionalAuthors &&
              repo.additionalAuthors.map((author) => author.name).join(', ')
          }))
      }
    },
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
