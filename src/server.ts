import { CardManager, ConfigManager, TerminalManager, CardRecord, ICardTag } from "sambadna-core";
import { List } from "immutable";
import { execute, subscribe } from 'graphql';
import { PubSub, withFilter } from 'graphql-subscriptions';
import { createServer } from 'http';
import { SubscriptionServer } from 'subscriptions-transport-ws';
import * as url from 'url';
import * as path from 'path';
import { acceptsFilter } from "./str";

import * as express from 'express';
import * as bodyParser from 'body-parser';
import { graphqlExpress, graphiqlExpress } from 'apollo-server-express';
import { makeExecutableSchema } from 'graphql-tools';


// The GraphQL schema in string form
const typeDefs = `
  input CardTag {
      name: String!,
      value: String!,
      typeId: String
  }

  input KV { 
      key: String!, 
      value: String! 
     }

  type KVT {
    key: String,
    value: String
  }

  type CardUpdate {
      card: Card,
      oldCard: Card
  }

  type Command {
      id: String,
      name: String,
      cardId: String,
      parameters: [KVT]
  }

  type Card { 
      id:String, cards: [Card], tags: [Tag], name: String, 
      category: String, debit: Float, credit:Float, balance: Float
    }

  type Tag { 
      id:String, name: String, value: String, quantity: Float, unit: String, 
      amount: Float, func: String, source: String, target: String 
    }

  type Query { 
      card(id: String!): Card, 
      cards(type: String, tagFilters: [KV]): [Card] 
    }

  type Mutation {
      enableTerminal(ti: String!, user: String!): String,
      createCard(ti: String!, cardType: String!, tags:[CardTag]): Card,
      executeAction(ti: String!, type: String!, cardId: String, actionCardId:String, data:[KV]): Card,
      executeCommand(ti: String!, name: String!, cardId: String, data:[KV]): Card,
      closeCard(ti: String!, cardId: String): Card
  }
  
  type Subscription { 
      cardUpdated(type: String, tags: [String], checkBalance: Boolean): CardUpdate,
      commandExecuted(name: String): Command
    }`;

const pubsub = new PubSub();

// The resolvers
const resolvers = {
    Query: {
        card(obj, args, context, info) {
            return CardManager.getCardById(args.id);
        },
        cards: (obj, args, context, info) => getCards(args)
    },
    Mutation: {
        enableTerminal: (root, args: { ti: string, user: string }, context, info) => {
            TerminalManager.enableTerminal(args.ti, args.user);
            return 'OK';
        },
        createCard: (root, args: { ti: string, cardType: string, tags: ICardTag[] }) => {
            try {
                return TerminalManager.createCard(args.ti, args.cardType, args.tags);
            } catch (error) {
                return error;
            }
        },
        executeAction: (root, args: { ti: string, cardId: string, actionCardId: string, type: string, data: IKeyValue[] }) => {
            try {
                const dataObj = args.data.reduce((r, kv) => {
                    r[kv.key] = kv.value;
                    return r;
                }, {});
                return TerminalManager.executeAction(args.ti, args.cardId, args.actionCardId, args.type, dataObj);
            } catch (error) {
                return error;
            }
        },
        executeCommand: (root, args: { ti: string, cardId: string, name: string, data: IKeyValue[] }) => {
            try {
                const dataObj = args.data.reduce((r, kv) => {
                    r[kv.key] = kv.value;
                    return r;
                }, {});
                return TerminalManager.executeCommand(args.ti, args.cardId, args.name, dataObj);
            } catch (error) {
                return error;
            }
        },
        closeCard: (root, args: { ti: string, cardId: string }) => {
            try {
                return TerminalManager.closeCard(args.ti, args.cardId);
            } catch (error) {
                return error;
            }
        }
    },
    Subscription: {
        cardUpdated: {
            subscribe: withFilter(
                () => pubsub.asyncIterator('cardUpdated'),
                (payload, variables) => {
                    let result = !variables.type || payload.type === ConfigManager.getCardTypeIdByRef(variables.type)
                    if (result && variables.tags && payload.cardUpdated.oldCard) {
                        const card = payload.cardUpdated.card as CardRecord;
                        const oldCard = payload.cardUpdated.oldCard as CardRecord;
                        const tags = variables.tags as string[];
                        result = tags.some(tag => card.getTagValue(tag, '') !== oldCard.getTagValue(tag, ''))
                    }
                    if (result && variables.checkBalance && payload.cardUpdated.oldCard) {
                        const card = payload.cardUpdated.card as CardRecord;
                        const oldCard = payload.cardUpdated.oldCard as CardRecord;
                        return card.balance !== oldCard.balance;
                    }
                    return result;
                }
            )
        },
        commandExecuted: {
            subscribe: withFilter(
                () => pubsub.asyncIterator('commandExecuted'),
                (payload, variables) => {
                    return !variables.name || acceptsFilter(payload.name, variables.name);
                }
            )
        }
    }
};

interface IKeyValue { key: string, value: string }
interface IArgs { type: string, showClosedCards: boolean, tagFilters: IKeyValue[] }

const getCards = (args: IArgs) => {
    const cardTypeId = ConfigManager.getCardTypeIdByRef(args.type);
    let result: List<CardRecord> = List<CardRecord>();
    result = cardTypeId ? CardManager.getCardsByType(cardTypeId) : CardManager.getCards().toList();
    if (!args.showClosedCards) {
        result = result.filter(x => !x.isClosed);
    }
    if (args.tagFilters) {
        result = result.filter(x => args.tagFilters.every(tf => x.hasTag(tf.key, tf.value)))
    }
    return result;
}

// Put together a schema
const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
});

export default class Server {
    private app = express();

    public connect(port: number) {
        this.app.use('/fonts', express.static(path.join(__dirname, '../../sambadna/build/fonts')));
        this.app.use(`/graphql`, bodyParser.json(), graphqlExpress({ schema }));
        this.app.use('/sambadna', express.static(path.join(__dirname, '../../sambadna/build'), { fallthrough: true }));
        this.app.use(`/graphiql`, (req, res, next) => {
            graphiqlExpress({
                endpointURL: `/graphql`,
                subscriptionsEndpoint: url.format({
                    host: req.get('host'),
                    protocol: req.protocol === 'https' ? 'wss' : 'ws',
                    slashes: true,
                    pathname: `/subscriptions`
                })
            })(req, res, next)
        });
        this.app.get('/', (req, res) => {
            res.redirect('/sambadna');
        });
        this.app.get('*', (req, res) => {
            res.sendFile(path.resolve(__dirname, '../../sambadna/build/index.html'));
        });


        const ws = createServer(this.app);

        ws.listen(port, () => {
            // tslint:disable-next-line:no-console
            console.log(`Subscription Server is now running on port:${port}`);

            return new SubscriptionServer({
                execute,
                subscribe,
                schema
            }, {
                    server: ws,
                    path: `/subscriptions`,
                });
        });
    }

    public cardUpdated(card: CardRecord, oldCard: CardRecord | undefined) {
        pubsub.publish('cardUpdated', { cardUpdated: { card, oldCard }, type: card.typeId });
    }

    public commandExecuted(command: { name: string, parameters: any, cardId: string, id: string }) {
        pubsub.publish('commandExecuted', { commandExecuted: command, name: command.name })
    }
}
