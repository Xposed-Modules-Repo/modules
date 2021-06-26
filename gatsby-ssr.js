/**
 * Implement Gatsby's SSR (Server Side Rendering) APIs in this file.
 *
 * See: https://www.gatsbyjs.org/docs/ssr-apis/
 */

// eslint-disable-next-line no-unused-vars
const React = require('react')

export const onPreRenderHTML = ({
  getHeadComponents,
  replaceHeadComponents,
  getPostBodyComponents,
  replacePostBodyComponents
}) => {
  const headComponents = getHeadComponents()
  headComponents.push(
    <link rel='stylesheet' href='https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap' media="print" onLoad="this.media='all'" />
  )
  headComponents.push(
    <link rel='stylesheet' href='https://fonts.googleapis.com/icon?family=Material+Icons' media="print" onLoad="this.media='all'" />
  )
  headComponents.push(
    <meta name="google-site-verification" content="No7OKPupiyITd5MI15QlaU1_u9raHcajSn8ffTPUGNI" />
  )
  replaceHeadComponents(headComponents)
  const postBodyComponents = getPostBodyComponents()
  postBodyComponents.unshift(
    <script dangerouslySetInnerHTML={{
      __html: '(function(){var i=-1,t=["__(:з 」∠)__","___(:з 」∠)_","____(:з 」∠)","____(:з」 ∠)","___(:з 」∠)_","___(:з」 ∠)_","__(:з 」∠)__","__(:з」 ∠)__","_(:з 」∠)___"];function f(){var d=document.querySelector(".splash");if(!d)return;i=i+1>=t.length?0:i+1;d.innerText=t[i];setTimeout(f,i>2&&i<8?250:1000)}f()})()'
    }} />
  )
  replacePostBodyComponents(postBodyComponents)
}
