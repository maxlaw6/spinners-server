// server.js

// --- Setup Express and Socket.IO ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors()); // Allow cross-origin requests

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity. For production, you'd restrict this.
    methods: ["GET", "POST"]
  }
});

// In-memory storage for all active games
const games = {};

// --- Game Constants ---
const SPINNER_VALUE = -1;
const TARGET_SCORE = 100;

// --- Game Logic Utilities ---

/**
 * Generates a complete deck of Double-Nine dominoes, including spinners.
 * @returns {Array<Object>} The generated deck.
 */
function generateDeck() {
    const deck = [];
    // Standard double-nine set
    for (let i = 0; i <= 9; i++) {
        for (let j = i; j <= 9; j++) {
            deck.push({ top: i, bottom: j, id: `d-${i}-${j}` });
        }
    }
    // Spinners (0 to 9)
    for (let i = 0; i <= 9; i++) {
        deck.push({ top: SPINNER_VALUE, bottom: i, id: `s-${i}` });
    }
    // Double-Spinner
    deck.push({ top: SPINNER_VALUE, bottom: SPINNER_VALUE, id: 'd-s-s' });
    return deck;
}

/**
 * Shuffles an array in place using the Fisher-Yates algorithm.
 * @param {Array<any>} array The array to shuffle.
 */
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/**
 * Calculates the point value of a player's hand.
 * @param {Array<Object>} hand The player's hand.
 * @returns {number} The total score of the hand.
 */
function calculateHandValue(hand) {
    return hand.reduce((total, domino) => {
        const topValue = domino.top === SPINNER_VALUE ? 10 : domino.top;
        const bottomValue = domino.bottom === SPINNER_VALUE ? 10 : domino.bottom;
        return total + topValue + bottomValue;
    }, 0);
}

/**
 * Creates a new game state object.
 * @param {string} gameId The unique ID for the game.
 * @param {number} playerCount The number of players.
 * @param {Object} playerNames A map of player numbers to names.
 * @returns {Object} The initial game state.
 */
function createNewGameState(gameId, playerCount, playerNames) {
    return {
        gameId,
        players: playerCount,
        playerNames: playerNames,
        sockets: {},
        currentPlayer: 1,
        scores: Object.fromEntries(Array.from({ length: playerCount }, (_, i) => [i + 1, 0])),
        hands: {},
        boneyard: [],
        boardDominos: [],
        moveHistory: [],
        turnState: 'WAITING', // WAITING, PLACED
        mustDrawToStart: false,
        currentTheme: 'classic',
        targetScore: TARGET_SCORE,
        roundNumber: 0,
        lastDrawnDominoId: null,
    };
}

/**
 * Starts a new round, deals cards, and determines the starting player.
 * @param {Object} gameState The current state of the game.
 */
function startNewRound(gameState) {
    gameState.roundNumber++;
    gameState.boardDominos = [];
    gameState.moveHistory = [];
    gameState.turnState = 'WAITING';
    
    const deck = generateDeck();
    shuffle(deck);

    // Deal hands
    const handSize = gameState.players <= 4 ? 9 : 7;
    for (let i = 1; i <= gameState.players; i++) {
        gameState.hands[i] = deck.splice(0, handSize);
    }
    gameState.boneyard = deck;

    // Determine who starts this round
    let starter = { player: null, domino: null, highestDouble: -2 };
    for (let p = 1; p <= gameState.players; p++) {
        for (const domino of gameState.hands[p]) {
            if (domino.top === domino.bottom && domino.top > starter.highestDouble) {
                starter = { player: p, domino, highestDouble: domino.top };
            }
        }
    }
    
    if (starter.player) {
        gameState.currentPlayer = starter.player;
        gameState.mustDrawToStart = false;
    } else {
        // No one has a double, the first player will have to draw.
        gameState.currentPlayer = (gameState.roundNumber - 1) % gameState.players + 1;
        gameState.mustDrawToStart = true;
    }
}


// --- Socket Connection Handler ---
io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // Create a new game
    socket.on('createGame', ({ playerCount, playerNames }) => {
        const gameId = Math.random().toString(36).substr(2, 5).toUpperCase();
        // Create the game state, but DON'T deal cards yet.
        const gameState = createNewGameState(gameId, playerCount, playerNames);
        gameState.sockets[1] = socket.id;
        games[gameId] = gameState;
        
        socket.join(gameId);
        // Emit the 'gameCreated' event with the initial "lobby" state
        socket.emit('gameCreated', { gameId, playerNum: 1, gameState });
        console.log(`Game ${gameId} created by ${playerNames[1]}. Waiting for players...`);
    });

    // Join an existing game
    socket.on('joinGame', ({ gameId, playerName }) => {
        const game = games[gameId];
        if (!game) {
            return socket.emit('error', { message: 'Game not found.' });
        }
        
        const playerNum = Object.keys(game.sockets).length + 1;
        if (playerNum > game.players) {
            return socket.emit('error', { message: 'Game is full.' });
        }

        game.sockets[playerNum] = socket.id;
        game.playerNames[playerNum] = playerName;
        
        socket.join(gameId);
        console.log(`${playerName} joined game ${gameId} as Player ${playerNum}.`);

        // Check if the game is now full
        if (Object.keys(game.sockets).length === game.players) {
            console.log(`Game ${gameId} is full. Starting round.`);
            // The lobby is full, NOW we start the game and deal the cards.
            startNewRound(game);
        }
        
        // Notify all players of the new join and updated state (either waiting or started)
        io.to(gameId).emit('gameUpdate', game);
    });

    // Handle all in-game actions
    socket.on('gameAction', ({ gameId, action, data }) => {
        const game = games[gameId];
        if (!game) return;

        const playerNumStr = Object.keys(game.sockets).find(key => game.sockets[key] === socket.id);
        if (!playerNumStr) return; // Player not found in this game
        
        const playerNum = parseInt(playerNumStr, 10);

        // Only allow actions from the current player
        if (playerNum !== game.currentPlayer) {
            return socket.emit('error', { message: "It's not your turn!" });
        }

        switch (action) {
            case 'placeDomino':
                const hand = game.hands[game.currentPlayer];
                const dominoIndex = hand.findIndex(d => d.id === data.dominoId);
                if (dominoIndex > -1) {
                    const [dominoData] = hand.splice(dominoIndex, 1);
                    game.boardDominos.push({ x: data.x, y: data.y, rotation: data.rotation, dominoData });
                    game.turnState = 'PLACED';
                    game.moveHistory.push({ action: 'place', player: game.currentPlayer, dominoData });

                    if (hand.length === 0) {
                        endRound(game, game.currentPlayer);
                        // Don't broadcast here, endRound will handle it
                        return; 
                    }
                }
                break;

            case 'draw':
                if (game.boneyard.length > 0) {
                    const drawnDomino = game.boneyard.pop();
                    game.hands[game.currentPlayer].push(drawnDomino);
                    game.lastDrawnDominoId = drawnDomino.id;
                    game.moveHistory.push({ action: 'draw', player: game.currentPlayer, dominoData: drawnDomino });
                }
                break;

            case 'endTurn':
                if (game.turnState === 'PLACED') {
                    game.currentPlayer = (game.currentPlayer % game.players) + 1;
                    game.turnState = 'WAITING';
                }
                break;
                
            case 'passTurn':
                // A robust server would validate here that the player truly has no valid moves.
                game.currentPlayer = (game.currentPlayer % game.players) + 1;
                game.turnState = 'WAITING';
                break;

            case 'undo':
                const lastMove = game.moveHistory.pop();
                if (lastMove && lastMove.player === game.currentPlayer) {
                    if (lastMove.action === 'place') {
                        // Find the specific domino on the board to remove
                        const boardDominoIndex = game.boardDominos.findIndex(d => d.dominoData.id === lastMove.dominoData.id);
                        if(boardDominoIndex > -1) {
                            game.boardDominos.splice(boardDominoIndex, 1);
                            game.hands[lastMove.player].push(lastMove.dominoData);
                            game.turnState = 'WAITING';
                        }
                    } else if (lastMove.action === 'draw') {
                        const handDominoIndex = game.hands[lastMove.player].findIndex(d => d.id === lastMove.dominoData.id);
                         if(handDominoIndex > -1) {
                            const [undrawnDomino] = game.hands[lastMove.player].splice(handDominoIndex, 1);
                            game.boneyard.push(undrawnDomino);
                        }
                    }
                } else if (lastMove) {
                    // If the move wasn't theirs, put it back
                    game.moveHistory.push(lastMove);
                }
                break;
                
            case 'startNextRound':
                startNewRound(game);
                break;

            case 'resetGame':
                const newGameState = createNewGameState(gameId, game.players, game.playerNames);
                newGameState.sockets = game.sockets;
                games[gameId] = newGameState;
                io.to(gameId).emit('gameUpdate', games[gameId]);
                return;
        }
        
        // Broadcast the updated game state to all players in the room
        io.to(gameId).emit('gameUpdate', game);
    });

    function endRound(game, winnerNum) {
        let totalScore = 0;
        for (let i = 1; i <= game.players; i++) {
            if (i !== winnerNum) {
                totalScore += calculateHandValue(game.hands[i]);
            }
        }
        game.scores[winnerNum] += totalScore;

        io.to(game.gameId).emit('roundEnd', { winner: winnerNum, scores: game.scores });

        // Check for game over
        if (game.scores[winnerNum] >= TARGET_SCORE) {
            setTimeout(() => {
                io.to(game.gameId).emit('gameOver', { scores: game.scores });
                delete games[game.gameId];
            }, 5000); // Wait 5 seconds before ending game
        }
    }

    socket.on('disconnect', () => {
        console.log(`A user disconnected: ${socket.id}`);
        // Find which game the user was in and handle their departure
        for (const gameId in games) {
            const game = games[gameId];
            const playerNum = Object.keys(game.sockets).find(key => game.sockets[key] === socket.id);
            if (playerNum) {
                console.log(`Player ${playerNum} (${game.playerNames[playerNum]}) left game ${gameId}.`);
                delete game.sockets[playerNum];
                // Optional: end the game if a player leaves
                io.to(gameId).emit('error', { message: `Player ${game.playerNames[playerNum]} has disconnected. Game over.` });
                delete games[gameId];
                break;
            }
        }
    });
});

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
