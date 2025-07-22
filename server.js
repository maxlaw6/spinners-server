
```javascript
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

let gameState = null;
let clients = [];
let playerNames = [];

class Domino {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.placed = false;
    this.isSpinner = a === 'S' && b === 'S';
    this.connectedEnds = { left: null, right: null, top: null, bottom: null };
  }

  getEnds() {
    if (this.isSpinner) {
      return [this.a, this.a, this.a, this.a];
    }
    if (this.rotation === 0 || this.rotation === 180) {
      return { left: this.a, right: this.b };
    } else {
      return { left: this.b, right: this.a };
    }
  }

  getScore() {
    let score = 0;
    if (this.a === 'S' && this.b === 'S') return 20;
    if (this.a === 'S') score += 10;
    else score += this.a;
    if (this.b === 'S') score += 10;
    else score += this.b;
    return score;
  }
}

function initializeGame(numPlayers, names) {
  console.log('Initializing game with ' + numPlayers + ' players: ' + names.join(', '));
  gameState = {
    dominoes: [],
    board: [],
    players: Array(numPlayers).fill().map(() => []),
    boneyard: [],
    currentPlayer: 0,
    selectedDomino: null,
    gameStarted: false,
    playerNames: names,
    currentRound: 9,
    spinner: null,
    openEnds: [],
    scores: Array(numPlayers).fill(0),
    doubleCounter: 0,
    doubleInPlay: null,
    roundWinner: 0
  };

  for (let i = 0; i <= 9; i++) {
    for (let j = i; j <= 9; j++) {
      gameState.dominoes.push(new Domino(i, j));
    }
  }
  gameState.dominoes.push(new Domino('S', 'S'));
  for (let i = 0; i <= 9; i++) {
    gameState.dominoes.push(new Domino('S', i));
  }

  for (let i = gameState.dominoes.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [gameState.dominoes[i], gameState.dominoes[j]] = [gameState.dominoes[j], gameState.dominoes[i]];
  }
  gameState.boneyard = [...gameState.dominoes];

  dealDominoes();
  findStartingPlayer();
  broadcastState();
}

function dealDominoes() {
  let dominoesPerPlayer = gameState.players.length === 2 ? 14 : 7;
  for (let i = 0; i < gameState.players.length; i++) {
    gameState.players[i] = [];
    for (let j = 0; j < dominoesPerPlayer; j++) {
      if (gameState.boneyard.length > 0) {
        let domino = gameState.boneyard.pop();
        positionDomino(domino, i, j);
        gameState.players[i].push(domino);
      }
    }
  }
}

function positionDomino(domino, playerIndex, dominoIndex) {
  const angleStep = 2 * Math.PI / gameState.players.length;
  const radius = 250;
  const centerX = 400;
  const centerY = 300;
  const angle = playerIndex * angleStep;
  domino.x = centerX + radius * Math.cos(angle) + (dominoIndex - gameState.players[playerIndex].length / 2) * 60 * Math.cos(angle + Math.PI / 2);
  domino.y = centerY + radius * Math.sin(angle) + (dominoIndex - gameState.players[playerIndex].length / 2) * 60 * Math.sin(angle + Math.PI / 2);
  domino.rotation = (angle + Math.PI / 2) * 180 / Math.PI;
}

function findStartingPlayer() {
  let hasSetDomino = false;
  for (let i = 0; i < gameState.players.length; i++) {
    for (let domino of gameState.players[i]) {
      if ((domino.a === gameState.currentRound && domino.b === gameState.currentRound) || (domino.a === 'S' && domino.b === 'S')) {
        gameState.currentPlayer = i;
        hasSetDomino = true;
        console.log('Starting player: ' + gameState.playerNames[i] + ' with [' + domino.a + '|' + domino.b + ']');
        break;
      }
    }
    if (hasSetDomino) break;
  }
  if (!hasSetDomino) {
    let drawRound = 0;
    while (!hasSetDomino && gameState.boneyard.length > 0) {
      let playerIndex = (gameState.roundWinner + drawRound) % gameState.players.length;
      if (gameState.boneyard.length > 0) {
        let domino = gameState.boneyard.pop();
        positionDomino(domino, playerIndex, gameState.players[playerIndex].length);
        gameState.players[playerIndex].push(domino);
        if ((domino.a === gameState.currentRound && domino.b === gameState.currentRound) || (domino.a === 'S' && domino.b === 'S')) {
          gameState.currentPlayer = playerIndex;
          hasSetDomino = true;
          console.log('Starting player after draw: ' + gameState.playerNames[playerIndex] + ' with [' + domino.a + '|' + domino.b + ']');
        }
        drawRound++;
      }
    }
  }
  if (!hasSetDomino) {
    gameState.currentRound--;
    if (gameState.currentRound >= 0) {
      console.log('No set domino found, moving to round ' + (10 - gameState.currentRound));
      initializeRound();
    } else {
      console.log('Game over: no set domino found in final round');
      endGame();
    }
  }
}

function initializeRound() {
  gameState.dominoes = [];
  gameState.board = [];
  gameState.players = Array(gameState.players.length).fill().map(() => []);
  gameState.boneyard = [];
  gameState.selectedDomino = null;
  gameState.gameStarted = false;
  gameState.spinner = null;
  gameState.openEnds = [];
  gameState.doubleCounter = 0;
  gameState.doubleInPlay = null;

  for (let i = 0; i <= 9; i++) {
    for (let j = i; j <= 9; j++) {
      gameState.dominoes.push(new Domino(i, j));
    }
  }
  gameState.dominoes.push(new Domino('S', 'S'));
  for (let i = 0; i <= 9; i++) {
    gameState.dominoes.push(new Domino('S', i));
  }

  for (let i = gameState.dominoes.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [gameState.dominoes[i], gameState.dominoes[j]] = [gameState.dominoes[j], gameState.dominoes[i]];
  }
  gameState.boneyard = [...gameState.dominoes];

  dealDominoes();
  findStartingPlayer();
  broadcastState();
}

function handlePlay(playerId, dominoIndex, x, y, rotation) {
  if (playerId !== gameState.currentPlayer || !gameState.players[playerId][dominoIndex]) {
    console.log('Invalid play attempt by player ' + playerId);
    return;
  }
  let domino = gameState.players[playerId][dominoIndex];
  let placement = canPlaceDomino(domino, x, y, rotation);
  if (placement) {
    domino.placed = true;
    domino.x = placement.x;
    domino.y = placement.y;
    domino.rotation = placement.rotation;
    if (domino.a === domino.b || (domino.a === 'S' && domino.b === 'S')) {
      domino.isSpinner = true;
      gameState.doubleInPlay = domino;
      gameState.doubleCounter = 0;
      console.log('Double played: [' + domino.a + '|' + domino.b + '] by ' + gameState.playerNames[playerId]);
    }
    gameState.board.push(domino);
    updateOpenEnds(domino, placement);
    gameState.players[playerId] = gameState.players[playerId].filter((_, i) => i !== dominoIndex);
    if (gameState.doubleInPlay) {
      gameState.doubleCounter++;
      if (gameState.doubleCounter >= 3) {
        gameState.doubleInPlay = null;
        gameState.doubleCounter = 0;
        console.log('Double play requirement satisfied');
      }
    }
    if (gameState.board.length === 1) {
      gameState.gameStarted = true;
      gameState.spinner = domino;
      console.log('Game started with [' + domino.a + '|' + domino.b + ']');
    }
    gameState.currentPlayer = (gameState.currentPlayer + 1) % gameState.players.length;
    console.log('Next player: ' + gameState.playerNames[gameState.currentPlayer]);
    checkGameEnd();
    broadcastState();
  } else {
    console.log('Invalid placement by player ' + playerId + ': [' + domino.a + '|' + domino.b + ']');
  }
}

function canPlaceDomino(domino, x, y, rotation) {
  domino.rotation = rotation;
  if (!gameState.gameStarted) {
    if ((domino.a === gameState.currentRound && domino.b === gameState.currentRound) || (domino.a === 'S' && domino.b === 'S')) {
      return { x: 400, y: 300, rotation: 0 };
    }
    return false;
  }
  if (gameState.doubleInPlay && gameState.doubleCounter < 3) {
    let matchNum = gameState.doubleInPlay.a === 'S' ? gameState.currentRound : gameState.doubleInPlay.a;
    for (let end of gameState.openEnds) {
      if (end.domino === gameState.doubleInPlay) {
        let canMatch = domino.a === matchNum || domino.b === matchNum || domino.a === 'S' || domino.b === 'S';
        if (canMatch) {
          let placement = getPlacementPosition(end, domino, x, y, rotation);
          if (placement) return placement;
        }
      }
    }
    return false;
  }
  for (let end of gameState.openEnds) {
    let canMatch = (domino.a === end.value || domino.b === end.value || domino.a === 'S' || domino.b === 'S');
    if (canMatch) {
      let placement = getPlacementPosition(end, domino, x, y, rotation);
      if (placement) return placement;
    }
  }
  return false;
}

function getPlacementPosition(end, domino, x, y, rotation) {
  let dx = end.x - x;
  let dy = end.y - y;
  if (Math.abs(dx) > 50 || Math.abs(dy) > 50) return false;
  let newX = end.x;
  let newY = end.y;
  if (end.side === 'left') newX -= 50;
  else if (end.side === 'right') newX += 50;
  else if (end.side === 'top') newY -= 30;
  else if (end.side === 'bottom') newY += 30;
  return { x: newX, y: newY, rotation };
}

function updateOpenEnds(domino, placement) {
  if (!gameState.gameStarted) {
    if (domino.isSpinner) {
      gameState.openEnds.push({ domino, value: domino.a === 'S' ? gameState.currentRound : domino.a, side: 'left', x: domino.x - 25, y: domino.y });
      gameState.openEnds.push({ domino, value: domino.a === 'S' ? gameState.currentRound : domino.a, side: 'right', x: domino.x + 25, y: domino.y });
      gameState.openEnds.push({ domino, value: domino.a === 'S' ? gameState.currentRound : domino.a, side: 'top', x: domino.x, y: domino.y - 15 });
      gameState.openEnds.push({ domino, value: domino.a === 'S' ? gameState.currentRound : domino.a, side: 'bottom', x: domino.x, y: domino.y + 15 });
    } else {
      let ends = domino.getEnds();
      gameState.openEnds.push({ domino, value: ends.left, side: 'left', x: domino.x - 25, y: domino.y });
      gameState.openEnds.push({ domino, value: ends.right, side: 'right', x: domino.x + 25, y: domino.y });
    }
    return;
  }
  let matchedEnd = gameState.openEnds.find(end => Math.abs(end.x - placement.x) < 50 && Math.abs(end.y - placement.y) < 50);
  if (matchedEnd) {
    gameState.openEnds = gameState.openEnds.filter(end => end !== matchedEnd);
    let ends = domino.getEnds();
    if (domino.isSpinner) {
      gameState.openEnds.push({ domino, value: domino.a === 'S' ? matchedEnd.value : domino.a, side: 'left', x: domino.x - 25, y: domino.y });
      gameState.openEnds.push({ domino, value: domino.a === 'S' ? matchedEnd.value : domino.a, side: 'right', x: domino.x + 25, y: domino.y });
      gameState.openEnds.push({ domino, value: domino.a === 'S' ? matchedEnd.value : domino.a, side: 'top', x: domino.x, y: domino.y - 15 });
      gameState.openEnds.push({ domino, value: domino.a === 'S' ? matchedEnd.value : domino.a, side: 'bottom', x: domino.x, y: domino.y + 15 });
    } else {
      let matchedValue = domino.a === matchedEnd.value || domino.a === 'S' ? domino.b : domino.a;
      let unmatchedValue = domino.a === matchedEnd.value || domino.a === 'S' ? domino.a : domino.b;
      if (placement.rotation === 0 || placement.rotation === 180) {
        gameState.openEnds.push({ domino, value: matchedValue, side: 'left', x: domino.x - 25, y: domino.y });
        gameState.openEnds.push({ domino, value: unmatchedValue, side: 'right', x: domino.x + 25, y: domino.y });
      } else {
        gameState.openEnds.push({ domino, value: matchedValue, side: 'top', x: domino.x, y: domino.y - 15 });
        gameState.openEnds.push({ domino, value: unmatchedValue, side: 'bottom', x: domino.x, y: domino.y + 15 });
      }
    }
  }
}

function handleDraw(playerId) {
  if (playerId !== gameState.currentPlayer || gameState.boneyard.length === 0) {
    gameState.currentPlayer = (gameState.currentPlayer + 1) % gameState.players.length;
    console.log('Player ' + playerId + ' passed (no tiles to draw)');
    broadcastState();
    return;
  }
  let domino = gameState.boneyard.pop();
  positionDomino(domino, playerId, gameState.players[playerId].length);
  gameState.players[playerId].push(domino);
  console.log('Player ' + gameState.playerNames[playerId] + ' drew [' + domino.a + '|' + domino.b + ']');
  gameState.currentPlayer = (gameState.currentPlayer + 1) % gameState.players.length;
  broadcastState();
}

function checkGameEnd() {
  if (gameState.players[gameState.currentPlayer].length === 0) {
    gameState.roundWinner = gameState.currentPlayer;
    for (let i = 0; i < gameState.players.length; i++) {
      gameState.scores[i] += gameState.players[i].reduce((sum, domino) => sum + domino.getScore(), 0);
    }
    gameState.scores[gameState.currentPlayer] += 0;
    console.log('Round ended. Winner: ' + gameState.playerNames[gameState.roundWinner] + '. Scores: ' + gameState.scores.join(', '));
    if (gameState.currentRound > 0) {
      gameState.currentRound--;
      initializeRound();
    } else {
      endGame();
    }
  }
}

function endGame() {
  let winnerIndex = gameState.scores.indexOf(Math.min(...gameState.scores));
  let winner = gameState.playerNames[winnerIndex];
  console.log('Game ended. Winner: ' + winner + ' with score ' + gameState.scores[winnerIndex]);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'gameOver',
        winner: gameState.playerNames[gameState.roundWinner],
        scores: gameState.scores,
        gameWinner: winner,
        winnerIndex
      }));
    }
  });
}

function broadcastState() {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'state', state: gameState }));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('New client connected');
  ws.on('message', (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      console.error('Invalid message received:', message);
      return;
    }
    if (msg.type === 'join') {
      clients.push(ws);
      ws.playerId = clients.length - 1;
      if (msg.names && msg.names[ws.playerId]) {
        playerNames.push(msg.names[ws.playerId]);
        console.log('Player ' + ws.playerId + ' joined: ' + msg.names[ws.playerId]);
      } else {
        console.error('Invalid names array in join message:', msg.names);
        return;
      }
      if (clients.length === msg.numPlayers) {
        initializeGame(msg.numPlayers, msg.names);
      }
      ws.send(JSON.stringify({ type: 'playerId', playerId: ws.playerId }));
    } else if (msg.type === 'play') {
      handlePlay(msg.playerId, msg.dominoIndex, msg.x, msg.y, msg.rotation);
    } else if (msg.type === 'draw') {
      handleDraw(msg.playerId);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected: Player ' + ws.playerId);
    clients = clients.filter(client => client !== ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

console.log('WebSocket server running on port ' + (process.env.PORT || 8080));
```
