<?php
// Public endpoint: GET /opf-upcoming.php
//
// What is coming next in OPF, for opf.iiteg.com. It is the admin board, read
// live: every card under "Coming next" (task 235, under OPF) that is not done
// or cancelled, and is urgent (the next update), high (soon) or normal
// (later), most urgent first. Low, or none, keeps a card on the board but off
// the site.
//
// Title, status and priority only. A card's description carries notes for
// us, and stays on the board.
//
// Lives in the OPF repository at tools/api/, uploaded to the root of
// api.iiteg.com beside datum-upcoming.php, whose config.php it shares.

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=60');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'GET only']);
    exit;
}

require_once __DIR__ . '/config.php';

// the card whose subtasks are the requests
const UPCOMING_PARENT = 235;

try {
    $st = db()->prepare(
        "SELECT title, status, priority FROM ws_tasks
          WHERE parent_id = ?
            AND priority IN ('urgent', 'high', 'normal')
            AND status NOT IN ('done', 'cancelled')
          ORDER BY CASE priority WHEN 'urgent' THEN 0
                                 WHEN 'high' THEN 1 ELSE 2 END,
                   sort_order, id");
    $st->execute([UPCOMING_PARENT]);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $items[] = [
            'title'    => (string)$row['title'],
            'status'   => (string)$row['status'],
            'priority' => (string)$row['priority'],
        ];
    }
    echo json_encode(['upcoming' => $items], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    // what went wrong is for the server log, not for the public
    error_log('opf-upcoming: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'unavailable']);
}
