import { ProtocolManager, CardManager, CardRecord, CommitRecord } from 'sambadna-core';
import Server from './server';
import * as minimist from 'minimist';
import * as url from 'url';

const options = minimist(process.argv.slice(2), {
    string: ['host', 'port', 'network', 'branch', 'user', 'terminal', 'gport'],
    default: {
        host: 'https://pmpos-node.herokuapp.com',
        port: 1234,
        gport: 80,
        network: 'DEMO',
        branch: '',
        user: 'gqluser',
        terminal: 'gqlterminal'
    }
});

let serverUrl: string = options.host;

if (!serverUrl.includes('://')) {
    serverUrl = url.format({
        protocol: 'http',
        hostname: options.host,
        port: options.port
    } as url.UrlObject);
}

// tslint:disable-next-line:no-console
console.log(`Connecting to: ${serverUrl}`);

const server = new Server();

ProtocolManager.connect(serverUrl, false, options.terminal, options.network, options.branch, options.user,
    (config) => {
        // ConfigManager.updateConfig(config);
    },
    (commits) => {
        const oldCards = commits.reduce((r: Map<string, CardRecord>, c: CommitRecord) => {
            if (CardManager.hasCard(c.cardId)) {
                const card = CardManager.getCardById(c.cardId) as CardRecord;
                return r.set(card.id, card);
            }
            return r;
        }, new Map<string, CardRecord>());
        CardManager.addCommits(commits);
        commits.map(c => server.cardUpdated(CardManager.getCardById(c.cardId) as CardRecord, oldCards.get(c.cardId)));
        commits.map(c => {
            const executeCommandActions = c.actions.filter(a => a.actionType === 'EXECUTE_COMMAND');
            executeCommandActions.forEach(a => server.commandExecuted(
                {
                    name: a.data.name,
                    cardId: a.cardId,
                    id: a.id,
                    parameters: a.data.params && Object.keys(a.data.params).map(key => ({ key, value: a.data.params[key] }))
                }));
        })
    }
);

server.connect(options.gport);