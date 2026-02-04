<?php
/**
 * Roundcube plugin: кнопка «Календарь» в панели задач (ссылка на CalDAV/CardDAV).
 * Для Mailu: открывает /webdav/.web (Radicale) в новой вкладке.
 */
class calendar_link extends rcube_plugin
{
    public $task = 'mail|settings';

    public function init()
    {
        $this->add_texts('localization/');
        $this->add_hook('render_page', [$this, 'add_calendar_button']);
    }

    public function add_calendar_button($args)
    {
        if ($args['template'] !== 'mail' && $args['template'] !== 'settings') {
            return $args;
        }
        $href = '/webdav/.web';
        $label = rcube::Q($this->gettext('calendar'));
        $title = rcube::Q($this->gettext('calendar_title'));
        $btn = html::tag('a', [
            'href'   => $href,
            'target' => '_blank',
            'class'  => 'button calendar',
            'title'  => $title,
        ], $label);
        $this->add_content($btn, 'taskbar');
        $this->add_content($btn, 'toolbar');
        return $args;
    }
}
