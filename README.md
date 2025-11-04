\# Streamr Operators Dashboard



This is a real-time, browser-based dashboard for monitoring and visualizing the Streamr Network, with a specific focus on network Operators. It provides a comprehensive, serverless web interface to track operator statistics, financial performance, stake, and geographical distribution.



The application runs entirely client-side, fetching and aggregating data from multiple live sources: Polygon blockchain smart contracts, The Graph Subgraphs, the PolygonScan API, and real-time Streamr data streams.



\## Key Features



\* \*\*Real-time Operator List:\*\* Fetches and displays a live, filterable list of all active Operators on the network.

\* \*\*Detailed Operator View:\*\* Allows users to select an operator to visualize detailed statistics, including:

&nbsp;   \* Total stake, operator's own stake, and delegation amounts.

&nbsp;   \* Accumulated earnings from sponsorships.

&nbsp;   \* Real-time uptime status, derived from live network heartbeats.

&nbsp;   \* Total number of delegators.

&nbsp;   \* Transaction history (delegations, earnings, etc.).

\* \*\*Network-Wide Visualization:\*\* Uses `Chart.js` to render responsive charts for aggregate network metrics and a global map of node locations.

\* \*\*Geographical Mapping:\*\* Visualizes the global distribution of operator nodes using `Leaflet.js`. Node locations are mapped using a static dataset (`locationData.js`) that links network region codes to geographical coordinates.

\* \*\*Direct API \& Blockchain Integration:\*\*

&nbsp;   \* \*\*Polygon Blockchain:\*\* Uses `Ethers.js` to connect directly to a Polygon RPC (`POLYGON\_RPC\_URL`) and query smart contracts (like `OperatorRegistry` and staking contracts) for all core financial data, stakes, and delegations.

&nbsp;   \* \*\*The Graph:\*\* Queries a specific Streamr Subgraph (`SUBGRAPH\_ID`) to fetch operator metadata, sponsorship data, and historical bucket data for charts.

&nbsp;   \* \*\*Streamr Network:\*\* Uses the `Streamr SDK` to subscribe to live data streams, including the `DATA/USDT` price feed (`DATA\_PRICE\_STREAM\_ID`) for value conversion and the operator coordination stream for uptime monitoring.

&nbsp;   \* \*\*PolygonScan API:\*\* Uses the `POLYGONSCAN\_API\_URL` to fetch detailed transaction histories for individual operators and delegators.

\* \*\*Wallet Connection:\*\* Integrates `Ethers.js` to allow users to connect their own Ethereum-compatible wallet (e.g., MetaMask). This enables features like checking personal delegations and interacting with contracts.

\* \*\*Serverless Architecture:\*\* A self-contained static web app. It requires no backend server and can be hosted on any static hosting provider or run locally by simply opening `index.html`.

\* \*\*Offline Caching:\*\* Implements a Service Worker (`sw.js`) using a "Network falling back to Cache" strategy for improved performance and offline resilience.



\## Technologies Used



\* \*\*Streamr SDK (`streamr-sdk.web.js`):\*\* For subscribing to real-time data streams on the Streamr Network.

\* \*\*Ethers.js (`ethers.umd.min.js`):\*\* For all Ethereum blockchain interactions, wallet connections, and smart contract queries on the Polygon network.

\* \*\*Chart.js:\*\* For rendering all responsive charts and data visualizations.

\* \*\*Leaflet.js:\*\* For rendering the interactive world map of operator nodes.

\* \*\*TailwindCSS:\*\* For all UI styling (loaded via CDN).

\* \*\*Core JavaScript (ES6 Modules):\*\*

&nbsp;   \* `main.js`: Core application controller, state management, and event listeners.

&nbsp;   \* `services.js`: Manages all external data fetching from smart contracts, The Graph, Streamr streams, and HTTP APIs.

&nbsp;   \* `ui.js`: Handles all DOM manipulation, data rendering, and updates to charts and the map.

&nbsp;   \* `constants.js`: Defines all smart contract ABIs, addresses, API endpoints, and other static configuration.

&nbsp;   \* `utils.js`: Provides helper functions for number formatting, value conversion, and date manipulation.

&nbsp;   \* `locationData.js`: A static data module mapping network region codes to coordinates.

\* \*\*Service Worker (`sw.js`):\*\* Provides background offline caching.

\* \*\*HTML5 \& CSS3:\*\* The foundation of the web application.



\## How to Run



1\.  Clone this repository or download the source files.

2\.  Open `index.html` in any modern web browser.



No installation, build step, or server setup is required. The app runs entirely client-side.



\## Contributing



Contributions are welcome! Feel free to open an issue or submit a pull request for any new features, bug fixes, or improvements.



\## License



This project is licensed under the MIT License.

