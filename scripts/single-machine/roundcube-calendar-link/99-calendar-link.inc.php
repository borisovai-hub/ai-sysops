<?php
// Calendar link button in Roundcube (link to /webdav/.web)
if (!isset($config["plugins"])) {
    $config["plugins"] = [];
}
if (!in_array("calendar_link", $config["plugins"])) {
    $config["plugins"][] = "calendar_link";
}
