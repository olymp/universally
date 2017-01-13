import React from 'react';
import { ServerRouter, createServerRenderContext } from 'react-router';
import { CodeSplitProvider, createRenderContext } from 'code-split-component';
import Helmet from 'react-helmet';
import generateHTML from 'universally/src/server/middleware/reactApplication/generateHTML';
import DemoApp from '@app';
import config from 'universally/config';
import fetch from 'node-fetch';
import { parse, stringify } from './query-string';
import { ApolloProvider } from 'react-apollo';
import { renderToStringWithData } from 'react-apollo/server';
import { ApolloClient, createNetworkInterface } from 'apollo-client';

global.fetch = fetch;
/**
 * An express middleware that is capabable of service our React application,
 * supporting server side rendering of the application.
 */
function reactApplicationMiddleware(request, response) {
  // We should have had a nonce provided to us.  See the server/index.js for
  // more information on what this is.
  if (typeof response.locals.nonce !== 'string') {
    throw new Error('A "nonce" value has not been attached to the response');
  }
  const nonce = response.locals.nonce;

  // It's possible to disable SSR, which can be useful in development mode.
  // In this case traditional client side only rendering will occur.
  if (config.disableSSR) {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('==> Handling react route without SSR');
    }
    // SSR is disabled so we will just return an empty html page and will
    // rely on the client to initialize and render the react application.
    const html = generateHTML({
      // Nonce which allows us to safely declare inline scripts.
      nonce,
    });
    response.status(200).send(html);
    return;
  }

  const port = process.env.PORT || config.port;

  const getUri = () => {
    if (process.env.GRAPHQL_URL) return process.env.GRAPHQL_URL;
    return process.env.URL || `http://localhost:${port}`;
  };
  const networkInterface = createNetworkInterface({
    uri: process.env.GRAPHQL_URL || `${getUri()}/graphql`,
    opts: {
      credentials: 'same-origin',
      headers: request.headers,
    },
  });
  const client = new ApolloClient({
    networkInterface,
    dataIdFromObject: o => o.id,
    ssrMode: true,
  });

  // First create a context for <ServerRouter>, which will allow us to
  // query for the results of the render.
  const reactRouterContext = createServerRenderContext();

  // We also create a context for our <CodeSplitProvider> which will allow us
  // to query which chunks/modules were used during the render process.
  const codeSplitContext = createRenderContext();

  // Create our React application and render it into a string.
  const reactApp = (
    <CodeSplitProvider context={codeSplitContext}>
      <ServerRouter stringifyQuery={stringify} parseQueryString={parse} location={decodeURI(request.url)} context={reactRouterContext}>
        <ApolloProvider client={client}>
          <DemoApp />
        </ApolloProvider>
      </ServerRouter>
    </CodeSplitProvider>
  );

  renderToStringWithData(reactApp).then((app) => {
  // Generate the html response.
  const html = generateHTML({
    // Provide the full app react element.
    app,
    initialState: client.store.getState().apollo.data,
    // Nonce which allows us to safely declare inline scripts.
    nonce,
    // Running this gets all the helmet properties (e.g. headers/scripts/title etc)
    // that need to be included within our html.  It's based on the rendered app.
    // @see https://github.com/nfl/react-helmet
    helmet: Helmet.rewind(),
    // We provide our code split state so that it can be included within the
    // html, and then the client bundle can use this data to know which chunks/
    // modules need to be rehydrated prior to the application being rendered.
    codeSplitState: codeSplitContext.getState(),
  });

  // Get the render result from the server render context.
  const renderResult = reactRouterContext.getResult();

  // Check if the render result contains a redirect, if so we need to set
  // the specific status and redirect header and end the response.
  if (renderResult.redirect) {
    response.status(301).setHeader('Location', renderResult.redirect.pathname);
    response.end();
    return;
  }

  response
    .status(
      renderResult.missed
        // If the renderResult contains a "missed" match then we set a 404 code.
        // Our App component will handle the rendering of an Error404 view.
        ? 404
        // Otherwise everything is all good and we send a 200 OK status.
        : 200,
    )
    .send(html);
  }).catch((err) => {
    response
      .status(500)
      .send(err);
  });
}

export default (reactApplicationMiddleware);