<?php

declare(strict_types=1);

namespace Mautic\LeadBundle\Tests\Form\Type;

use Mautic\CoreBundle\Test\MauticMysqlTestCase;
use Mautic\LeadBundle\Entity\Tag;
use Mautic\LeadBundle\Form\Type\CampaignEventLeadTagsType;
use Symfony\Component\Form\FormFactoryInterface;

final class CampaignEventLeadTagsTypeFunctionalTest extends MauticMysqlTestCase
{
    public function testSubmittedTagsAreKeptAsTagNames(): void
    {
        $tag = $this->createTag('ade-cliente');
        $this->createTag('ado-cliente');

        $form = $this->getFormFactory()->create(CampaignEventLeadTagsType::class, [], ['csrf_protection' => false]);
        $form->submit(['tags' => [(string) $tag->getId()]]);

        $this->assertTrue($form->isSynchronized());
        $this->assertSame(['ade-cliente'], $form->getData()['tags']);
    }

    public function testSavedTagsArePreselectedWhenTheFormIsReopened(): void
    {
        $tag = $this->createTag('ade-cliente');
        $this->createTag('ado-cliente');

        $form = $this->getFormFactory()->create(CampaignEventLeadTagsType::class, ['tags' => ['ade-cliente']], ['csrf_protection' => false]);

        $this->assertSame([(string) $tag->getId()], array_values($form->createView()['tags']->vars['value']));
    }

    private function createTag(string $name): Tag
    {
        $tag = new Tag($name);
        $this->em->persist($tag);
        $this->em->flush();

        return $tag;
    }

    private function getFormFactory(): FormFactoryInterface
    {
        return static::getContainer()->get('form.factory');
    }
}
